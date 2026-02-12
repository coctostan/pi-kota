# Phase 2/3 Hardening Follow-ups Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Make pi-kota hardening follow-ups real: best-effort structured logging, concurrency-safe indexing, once-per-HEAD staleness nudges, no startup side effects, and ≥90% line coverage for `src/`.

**Architecture:** Keep the current extension entrypoint (`export default function (pi: ExtensionAPI)`), but harden the behavior with small internal state additions and safer wrappers. Improve testability primarily by adding focused tests that drive the extension via the existing `createMockApi()` harness and light module mocks.

**Tech Stack:** TypeScript (ESM), Vitest (+ v8 coverage), pi extension API.

---

## Prereqs / One-time setup

- Work in an isolated branch/worktree (recommended):

  ```bash
  git status
  git switch -c feat/phase2-3-hardening-followups
  ```

- Establish baseline:

  ```bash
  npm test
  npm run typecheck
  ```

---

### Task 1: Add an explicit coverage run + thresholds (expect initial failure)

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`

**Step 1: Add a failing coverage run (script only)**

Edit `package.json` scripts to add:

```json
{
  "scripts": {
    "test:cov": "vitest run --coverage"
  }
}
```

**Step 2: Run coverage to confirm we see current shortfall**

Run:

```bash
npm run test:cov
```

Expected: coverage report prints, and (currently) overall `src/` line coverage is < 90%.

**Step 3: Configure coverage collection + thresholds**

Edit `vitest.config.ts` to:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**"],
      exclude: ["**/*.d.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 80,
      },
    },
  },
});
```

**Step 4: Re-run coverage to verify it fails on thresholds (red)**

Run:

```bash
npm run test:cov
```

Expected: FAIL with a message like “Coverage for lines (…) does not meet threshold (90%)”.

**Step 5: Commit**

```bash
git add package.json vitest.config.ts
git commit -m "test: add explicit coverage run + thresholds"
```

---

### Task 2: Make file logger best-effort (never throws)

**Files:**
- Modify: `src/logger.ts`
- Modify: `tests/logger.test.ts`

**Step 1: Write a failing test for unwritable log paths**

Append to `tests/logger.test.ts`:

```ts
  it("never throws if the log path is unwritable", async () => {
    // Likely unwritable in CI/local as non-root.
    const logger = await createLogger({ enabled: true, path: "/root/pi-kota-debug.jsonl" });

    await expect(logger.log("mcp", "connected", { repo: "/tmp/repo" })).resolves.toBeUndefined();
    await expect(logger.close()).resolves.toBeUndefined();
  });
```

**Step 2: Run the test to see it fail (red)**

Run:

```bash
npm test -- tests/logger.test.ts -v
```

Expected: FAIL (today) because `createLogger()` or `log()` throws on `mkdir` / `appendFile`.

**Step 3: Implement best-effort semantics in `src/logger.ts`**

Replace `createLogger()` with a non-throwing implementation:

```ts
export async function createLogger(opts: { enabled: boolean; path?: string }): Promise<Logger> {
  if (!opts.enabled || !opts.path) return noopLogger;

  const logPath = opts.path;
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
  } catch {
    // If we can't create the directory, fall back to noop.
    return noopLogger;
  }

  return {
    async log(category: string, event: string, data?: Record<string, unknown>): Promise<void> {
      try {
        const entry = JSON.stringify({ ts: new Date().toISOString(), category, event, data }) + "\n";
        await appendFile(logPath, entry, "utf8");
      } catch {
        // best-effort: never throw
      }
    },
    async close(): Promise<void> {
      // no-op for append logger (but never throw)
    },
  };
}
```

**Step 4: Re-run the logger test (green)**

Run:

```bash
npm test -- tests/logger.test.ts -v
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "fix: make debug logger best-effort (never throws)"
```

---

### Task 3: Make `ensureIndexed()` concurrency-safe via promise dedupe

**Files:**
- Modify: `src/kota/ensure.ts`
- Modify: `tests/kota-ensure.test.ts`

**Step 1: Add a true concurrency regression test (red)**

Append to `tests/kota-ensure.test.ts`:

```ts
  it("dedupes concurrent calls (index runs once)", async () => {
    const state: { indexed: boolean; indexPromise: Promise<void> | null } = {
      indexed: false,
      indexPromise: null,
    };

    let indexCalls = 0;
    let releaseBarrier: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const index = vi.fn(async () => {
      indexCalls++;
      await barrier;
    });

    const p1 = ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    const p2 = ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    // Let both callers enter ensureIndexed before releasing.
    await Promise.resolve();
    releaseBarrier?.();

    await Promise.all([p1, p2]);

    expect(indexCalls).toBe(1);
    expect(index).toHaveBeenCalledTimes(1);
    expect(state.indexed).toBe(true);
  });
```

**Step 2: Run the test to confirm failure (red)**

Run:

```bash
npm test -- tests/kota-ensure.test.ts -v
```

Expected: FAIL (today) because both concurrent calls run `index()`.

**Step 3: Implement promise dedupe in `src/kota/ensure.ts`**

Replace the function with:

```ts
export async function ensureIndexed(opts: {
  state: { indexed: boolean; indexPromise?: Promise<void> | null };
  confirmIndex: boolean;
  confirm: (title: string, msg: string) => Promise<boolean>;
  index: () => Promise<void>;
}): Promise<void> {
  if (opts.state.indexed) return;

  // Promise de-dupe for true concurrency safety.
  if (opts.state.indexPromise) {
    await opts.state.indexPromise;
    return;
  }

  const run = (async () => {
    if (opts.confirmIndex) {
      const ok = await opts.confirm(
        "Index repository?",
        "KotaDB indexing can take a while. Index this repository now?",
      );
      if (!ok) throw new Error("Indexing cancelled by user");
    }

    await opts.index();
    opts.state.indexed = true;
  })();

  opts.state.indexPromise = run;
  try {
    await run;
  } finally {
    // Always clear the in-flight promise.
    opts.state.indexPromise = null;
  }
}
```

**Step 4: Re-run tests (green)**

Run:

```bash
npm test -- tests/kota-ensure.test.ts -v
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/kota/ensure.ts tests/kota-ensure.test.ts
git commit -m "fix: dedupe concurrent ensureIndexed calls"
```

---

### Task 4: Extend runtime state for indexing + staleness warning tracking

**Files:**
- Modify: `src/runtime.ts`
- Modify: `tests/runtime.test.ts`

**Step 1: Add failing assertions for new defaults (red)**

Append to `tests/runtime.test.ts`:

```ts
  it("tracks index promise + staleness warnings", () => {
    const s = createInitialRuntimeState() as any;
    expect(s.indexPromise).toBe(null);
    expect(s.stalenessWarnedForHead).toBe(null);
  });
```

**Step 2: Run runtime tests (red)**

Run:

```bash
npm test -- tests/runtime.test.ts -v
```

Expected: FAIL because the fields do not exist yet.

**Step 3: Implement new fields in `src/runtime.ts`**

Update `RuntimeState`:

```ts
  // …existing fields…

  // Concurrency safety: in-flight indexing promise.
  indexPromise: Promise<void> | null;

  // UX: warn at most once per distinct HEAD in a session.
  stalenessWarnedForHead: string | null;
```

Update `createInitialRuntimeState()` to include:

```ts
    indexPromise: null,
    stalenessWarnedForHead: null,
```

**Step 4: Re-run runtime tests (green)**

Run:

```bash
npm test -- tests/runtime.test.ts -v
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts
git commit -m "chore: extend runtime state for indexing + staleness tracking"
```

---

### Task 5: Remove startup blob eviction side-effect (de-scope)

**Files:**
- Modify: `src/index.ts`
- Create: `tests/index-session-start.test.ts`

**Step 1: Add a failing test that asserts we do NOT evict on session_start**

Create `tests/index-session-start.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// Mock config to enable blobs to prove we still don't evict at startup.
vi.mock("../src/config.js", () => {
  return {
    loadConfig: vi.fn(async () => ({
      config: {
        kota: { command: "kota", args: [], connectTimeoutMs: 10_000, confirmIndex: false, autoContext: { enabled: false } },
        prune: { enabled: false, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
        blobs: { enabled: true, dir: "/tmp/blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
        log: { enabled: false },
      },
      sources: { global: "(mock)", project: "(mock)" },
    }))
  };
});

const evictSpy = vi.fn(async () => {});
vi.mock("../src/blobs-evict.js", () => ({ evictBlobs: evictSpy }));

import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

describe("index.ts session_start", () => {
  it("does not evict blobs on session_start", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn(async () => true) },
    };

    await api.fire("session_start", {}, ctx);

    expect(evictSpy).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the new test (red)**

Run:

```bash
npm test -- tests/index-session-start.test.ts -v
```

Expected: FAIL (today) because `session_start` calls `evictBlobs()` when blobs are enabled.

**Step 3: Remove the eviction call from `src/index.ts`**

In the `pi.on("session_start", …)` handler, delete this block:

```ts
    if (state.config?.blobs.enabled) {
      evictBlobs({
        dir: state.config.blobs.dir,
        maxAgeDays: state.config.blobs.maxAgeDays,
        maxSizeBytes: state.config.blobs.maxSizeBytes,
      }).catch(() => {});
    }
```

(Keep blob writing/truncation in the `tool_result` handler unchanged.)

**Step 4: Re-run the test (green)**

Run:

```bash
npm test -- tests/index-session-start.test.ts -v
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts tests/index-session-start.test.ts
git commit -m "chore: remove startup blob eviction side-effect"
```

---

### Task 6: Make all extension logging best-effort + stop logging tool args

**Files:**
- Modify: `src/index.ts`

**Step 1: Add a small safe-logger wrapper in `src/index.ts`**

Near the top of `src/index.ts` (inside `export default function (pi)`), replace:

```ts
  let logger: Logger = { async log() {}, async close() {} };
```

with:

```ts
  function makeSafeLogger(inner: Logger): Logger {
    return {
      async log(category: string, event: string, data?: Record<string, unknown>) {
        try {
          await inner.log(category, event, data);
        } catch {
          // best-effort
        }
      },
      async close() {
        try {
          await inner.close();
        } catch {
          // best-effort
        }
      },
    };
  }

  let logger: Logger = makeSafeLogger({ async log() {}, async close() {} });
```

Then in `session_start`, wrap the created logger:

```ts
    logger = makeSafeLogger(
      await createLogger({
        enabled: state.config?.log.enabled ?? false,
        path: state.config?.log.path,
      }),
    );
```

**Step 2: Update MCP connect/disconnect logging to match new event names (optional but recommended)**

Update:
- `("mcp", "connected", …)` stays
- `("mcp", "connect-error", …)` → `("mcp", "connect_error", …)`

(If you do this rename, also update any tests you add that assert the event string.)

**Step 3: Stop logging tool args; log start/end + duration only**

In `callKotaTool()`, replace the existing log call:

```ts
    await logger.log("tool", "call", {
      toolName,
      args: String(JSON.stringify(args) ?? "").slice(0, 200),
    });
```

with:

```ts
    const t0 = Date.now();
    await logger.log("tool", "call_start", { toolName });
```

Then after the `callBudgeted()` returns, log an end event. Implement it like this:

```ts
    const release = state.inFlight.acquire();
    try {
      const res = await callBudgeted({
        toolName,
        args,
        maxChars: 5000,
        listTools: () => state.mcp!.listTools(),
        callTool: (n, a) => state.mcp!.callTool(n, a),
        onTransportError: () => state.mcp?.disconnect(),
      });

      await logger.log("tool", "call_end", {
        toolName,
        ok: res.ok,
        durationMs: Date.now() - t0,
      });

      return res;
    } finally {
      release();
    }
```

**Step 4: Ensure `session_shutdown` remains non-fatal**

Keep `await logger.close().catch(() => {});` OR simplify to `await logger.close();` now that logger is safe. Either is acceptable; prefer a single mechanism (not both).

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "fix: make extension logging best-effort + remove tool arg logging"
```

---

### Task 7: Staleness warnings: once per distinct HEAD (UI-only) + structured log

**Files:**
- Modify: `src/index.ts`

**Step 1: Implement warn-once-per-HEAD tracking**

Replace `checkStaleness()` with:

```ts
  async function checkStaleness(ctx: { cwd: string; hasUI?: boolean; ui?: any }): Promise<void> {
    if (!state.indexedAtCommit || !state.repoRoot) return;

    const head = await getHeadCommit(pi, state.repoRoot);
    if (!head) return;

    // Warn at most once per distinct HEAD value.
    if (state.stalenessWarnedForHead === head) return;

    if (!isIndexStale(state.indexedAtCommit, head)) return;

    await logger.log("index", "stale_detected", {
      indexedAtCommit: state.indexedAtCommit,
      head,
    });

    if (ctx.hasUI) {
      ctx.ui.notify(
        "pi-kota: repo HEAD has changed since last index. Run /kota index to update.",
        "warning",
      );
    }

    state.stalenessWarnedForHead = head;
  }
```

**Step 2: Ensure staleness warning state resets on `/kota restart`**

In the `/kota restart` command handler, add:

```ts
        state.stalenessWarnedForHead = null;
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: warn about stale index once per HEAD"
```

---

### Task 8: Wire indexing promise dedupe through the extension

**Files:**
- Modify: `src/index.ts`

**Step 1: Pass `indexPromise` through to `ensureIndexed()` in BOTH index paths**

In `ensureRepoIndexed()` change the `state:` object passed into `ensureIndexed()` to:

```ts
      state: {
        get indexed() {
          return state.indexedRepoRoot === targetPath;
        },
        set indexed(v: boolean) {
          state.indexedRepoRoot = v ? targetPath : null;
        },
        get indexPromise() {
          return state.indexPromise;
        },
        set indexPromise(p: Promise<void> | null) {
          state.indexPromise = p;
        },
      },
```

Do the same in the `/kota index` command handler’s `ensureIndexed({ state: … })` call.

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "fix: dedupe concurrent indexing runs in extension"
```

---

### Task 9: Add extension-level tests for staleness warn-once + concurrent indexing

**Files:**
- Create: `tests/index-staleness-and-indexing.test.ts`

**Step 1: Create an extension test that simulates HEAD changes + concurrent tool calls (red first)**

Create `tests/index-staleness-and-indexing.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

// Mock config to avoid reading real disk config.
vi.mock("../src/config.js", () => {
  return {
    loadConfig: vi.fn(async () => ({
      config: {
        kota: {
          command: "kota",
          args: [],
          connectTimeoutMs: 10_000,
          confirmIndex: false,
          autoContext: { enabled: false },
        },
        prune: { enabled: false, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
        blobs: { enabled: false, dir: "/tmp/blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
        log: { enabled: false },
      },
      sources: { global: "(mock)", project: "(mock)" },
    }))
  };
});

// Fully mock the MCP client so we never start a real kotadb process.
let indexCalls = 0;
let releaseIndexBarrier: (() => void) | null = null;

vi.mock("../src/kota/mcp.js", () => {
  class KotaMcpClient {
    connected = false;
    async connect() {
      this.connected = true;
    }
    isConnected() {
      return this.connected;
    }
    async listTools() {
      return ["index_repository", "search"];
    }
    async callTool(name: string, _args: any) {
      if (name === "index_repository") {
        indexCalls++;
        const barrier = new Promise<void>((resolve) => {
          releaseIndexBarrier = resolve;
        });
        await barrier;
        return { content: [{ type: "text", text: "indexed" }], raw: { ok: true } };
      }
      if (name === "search") {
        return { content: [{ type: "text", text: "ok" }], raw: { ok: true } };
      }
      return { content: [{ type: "text", text: "unknown" }], raw: {} };
    }
    disconnect() {
      this.connected = false;
    }
    async close() {
      this.connected = false;
    }
  }

  return { KotaMcpClient };
});

describe("index.ts staleness + indexing", () => {
  it("warns at most once per HEAD when index is stale", async () => {
    const api = createMockApi();

    // Control git HEAD responses.
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: (api as any).__head + "\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });
    (api as any).__head = "HEAD-1";

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    // Mark repo as indexed by calling kota_index (will call index_repository once).
    const kotaIndex = api.tools.get("kota_index");

    // Release the index barrier so indexing can finish.
    const pIndex = kotaIndex.execute("id", {}, undefined, undefined, ctx);
    await Promise.resolve();
    releaseIndexBarrier?.();
    await pIndex;

    // Now HEAD changes; first use should warn.
    (api as any).__head = "HEAD-2";
    const search = api.tools.get("kota_search");
    await search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

    // Second use with same HEAD should NOT warn again.
    await search.execute("id", { query: "y", output: "paths", limit: 1 }, undefined, undefined, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("dedupes concurrent indexing from multiple tool calls", async () => {
    indexCalls = 0;
    releaseIndexBarrier = null;

    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: "HEAD-1\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    const search = api.tools.get("kota_search");

    const p1 = search.execute("id", { query: "a", output: "paths", limit: 1 }, undefined, undefined, ctx);
    const p2 = search.execute("id", { query: "b", output: "paths", limit: 1 }, undefined, undefined, ctx);

    await Promise.resolve();
    releaseIndexBarrier?.();

    await Promise.all([p1, p2]);

    expect(indexCalls).toBe(1);

    await api.fire("session_shutdown", {}, ctx);
  });
});
```

**Step 2: Run the new test suite (red → green)**

Run:

```bash
npm test -- tests/index-staleness-and-indexing.test.ts -v
```

Expected:
- Initially FAIL until Tasks 7–8 are implemented.
- Then PASS.

**Step 3: Commit**

```bash
git add tests/index-staleness-and-indexing.test.ts
git commit -m "test: cover staleness warn-once + concurrent indexing"
```

---

### Task 10: Verify overall suite + coverage target

**Files:**
- (No code changes; verification only)

**Step 1: Run unit tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

**Step 3: Run coverage gating**

Run:

```bash
npm run test:cov
```

Expected: PASS and printed thresholds met (≥90% lines on `src/**`).

**Step 4: Final commit (if any small fixes were needed)**

```bash
git status
# If needed:
# git add -A
# git commit -m "chore: address coverage gaps"
```

---

## Notes / Guardrails (from design)

- **Must keep:** staleness detection via `indexedAtCommit` vs `git rev-parse HEAD`.
- **Must keep:** structured JSONL debug logging, but **best-effort** and **never breaks** core flows.
- **De-scoped:** no blob eviction on `session_start`.
- **De-scoped:** do not log tool args.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-02-11-phase2-3-hardening-followups.md`. Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?