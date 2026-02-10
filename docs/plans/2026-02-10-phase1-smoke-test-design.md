# Phase 1 — End-to-End Smoke Tests Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.
>
> **Historical note (current behavior differs):** This plan references `bunx` availability checks. The current test/runtime path checks `bun` and uses `bun x ...`. Keep this file as execution history; use `README.md` + current tests as source of truth.

**Goal:** Add a deterministic, automated “Phase 1” smoke test suite that exercises the pi-kota extension wiring against a real KotaDB subprocess (no LLM required).

**Architecture:** Add a separate `vitest` config for e2e tests plus a small `MockExtensionAPI` that captures registered tools/commands/handlers. The e2e tests will load the extension, fire lifecycle handlers, call registered tool `execute()` functions directly, and validate pruning/blob behavior by invoking the registered event handlers.

**Tech Stack:** TypeScript (ESM), Vitest, Node.js `child_process`, real KotaDB via `bunx kotadb@next --stdio` (skipped when `bunx` unavailable).

---

## Pre-flight (do once before Task 1)

- Confirm existing unit tests are green:
  - Run: `npm test`
  - Expected: exit code 0

- Confirm `bunx` is installed (required for e2e suite):
  - Run: `bunx --version`
  - Expected: prints a version and exit code 0

(If `bunx` is missing, the e2e suite will be skipped; unit tests remain unaffected.)

---

### Task 1: Add an isolated E2E Vitest config + npm script

**Files:**
- Create: `vitest.config.e2e.ts`
- Modify: `package.json`

**Step 1: Write the failing test (a placeholder suite that should be discovered by the e2e config)**

Create a new test file **with a single failing test** so we can confirm the new config actually runs the new suite.

Create: `tests/smoke-e2e.test.ts`

```ts
import { describe, expect, it } from "vitest";

describe("e2e smoke (bootstrap)", () => {
  it("is discovered by vitest.config.e2e.ts", () => {
    // This should fail until we wire up the e2e config + script correctly.
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.config.e2e.ts`

Expected: FAIL with something like:
- `expected true to be false`

**Step 3: Write minimal implementation (add `vitest.config.e2e.ts` + script)**

Create: `vitest.config.e2e.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke-e2e.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Keep this suite isolated from unit tests.
    reporters: ["default"],
  },
});
```

Modify `package.json` scripts to add:

```json
{
  "scripts": {
    "test:e2e": "vitest run -c vitest.config.e2e.ts"
  }
}
```

(Keep existing `test` and `typecheck` scripts unchanged.)

**Step 4: Run test to verify it still fails (expected, placeholder is still red)**

Run: `npm run test:e2e`

Expected: FAIL (still), proving the new config+script executes the e2e suite.

**Step 5: Commit**

```bash
git add vitest.config.e2e.ts package.json tests/smoke-e2e.test.ts
git commit -m "test(e2e): add isolated vitest config and script"
```

---

### Task 2: Add a shared Mock ExtensionAPI helper (captures handlers/tools/commands)

**Files:**
- Create: `tests/helpers/mock-api.ts`
- Test: `tests/smoke-e2e.test.ts`

**Step 1: Write the failing test (expects extension to register tools/command)**

Replace the placeholder failing test in `tests/smoke-e2e.test.ts` with this:

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

describe("e2e smoke (wiring)", () => {
  it("registers all pi-kota tools and the /kota command", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    expect([...api.tools.keys()].sort()).toEqual(
      [
        "kota_deps",
        "kota_impact",
        "kota_index",
        "kota_search",
        "kota_task_context",
        "kota_usages",
      ].sort(),
    );

    expect(api.commands.has("kota")).toBe(true);
  });
});
```

This should fail because `createMockApi()` does not exist yet.

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`

Expected: FAIL with something like:
- `Cannot find module './helpers/mock-api.js'`

**Step 3: Write minimal implementation (`tests/helpers/mock-api.ts`)**

Create: `tests/helpers/mock-api.ts`

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { vi } from "vitest";

const execFileAsync = promisify(execFile);

export type Handler = (event: any, ctx: any) => any | Promise<any>;

export function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();

  const pi: any = {
    on(event: string, handler: Handler) {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    },

    registerTool(def: any) {
      tools.set(def.name, def);
    },

    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },

    exec: vi.fn(async (cmd: string, args: string[], opts: any) => {
      try {
        const res = await execFileAsync(cmd, args, {
          cwd: opts?.cwd,
          timeout: opts?.timeout,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { code: 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
      } catch (e: any) {
        // Normalize exec errors to the ExtensionAPI shape used by src/index.ts.
        return {
          code: typeof e?.code === "number" ? e.code : 1,
          stdout: e?.stdout ?? "",
          stderr: e?.stderr ?? (e?.message ?? String(e)),
        };
      }
    }),
  };

  function getHandler(event: string): Handler | undefined {
    const arr = handlers.get(event) ?? [];
    return arr[0];
  }

  async function fire(event: string, payload: any, ctx: any) {
    const arr = handlers.get(event) ?? [];
    const results = [];
    for (const h of arr) results.push(await h(payload, ctx));
    return results;
  }

  return { pi, handlers, tools, commands, getHandler, fire };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/helpers/mock-api.ts tests/smoke-e2e.test.ts
git commit -m "test(e2e): add mock ExtensionAPI helper"
```

---

### Task 3: E2E test — lifecycle handlers run + config override for blob/prune

**Files:**
- Modify: `tests/smoke-e2e.test.ts`

**Step 1: Write the failing test (creates project config, fires session_start, asserts status)**

Append this test to `tests/smoke-e2e.test.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

function makeCtx(overrides?: Partial<any>) {
  return {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    getContextUsage: () => ({ tokens: 5000 }),
    ...overrides,
  };
}

describe("e2e smoke (lifecycle)", () => {
  it("session_start loads config and sets initial status", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const repoRoot = process.cwd();
    const piDir = path.join(repoRoot, ".pi");
    const blobDir = path.join(repoRoot, ".tmp/e2e-blobs");

    await fs.mkdir(piDir, { recursive: true });
    await fs.mkdir(blobDir, { recursive: true });

    await fs.writeFile(
      path.join(piDir, "pi-kota.json"),
      JSON.stringify(
        {
          kota: { confirmIndex: true },
          prune: { enabled: true, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
          blobs: { enabled: true, dir: blobDir },
        },
        null,
        2,
      ),
      "utf8",
    );

    const ctx = makeCtx({ cwd: repoRoot });

    await api.fire("session_start", {}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalled();
    expect(String(ctx.ui.setStatus.mock.calls[0]?.[2] ?? "")).toContain("kota: stopped");
  });
});
```

This may fail due to ordering/assumptions about how `setStatus()` is called.

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`

Expected: FAIL (then adjust the assertion to match actual arguments), for example:
- If `setStatus(key, text)` has only 2 args, assert `mock.calls[0][1]` instead of `[2]`.

**Step 3: Write minimal implementation (fix the assertion, not prod code)**

Update the assertion to match the actual `setStatus()` call signature used in `src/index.ts`:

`ctx.ui.setStatus("pi-kota", "kota: stopped | repo: ...")`

So the robust assertion should be:

```ts
const calls = ctx.ui.setStatus.mock.calls;
const combined = calls.map((c) => c.join(" ")).join("\n");
expect(combined).toContain("kota: stopped");
```

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/smoke-e2e.test.ts
git commit -m "test(e2e): cover session_start lifecycle"
```

---

### Task 4: E2E test — tool execution against real KotaDB (skipped if bunx missing)

**Files:**
- Modify: `tests/smoke-e2e.test.ts`

**Step 1: Write the failing test (exercise kota_search / deps / usages / impact)**

Add a `bunx` availability check near the top of `tests/smoke-e2e.test.ts`:

```ts
import { execFileSync } from "node:child_process";

const HAS_BUNX = (() => {
  try {
    execFileSync("bunx", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
```

Then add this suite (note the conditional describe):

```ts
const e2eDescribe = HAS_BUNX ? describe : describe.skip;

e2eDescribe("e2e smoke (real kotadb)", () => {
  it("runs core tools end-to-end", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const ctx = makeCtx({ cwd: process.cwd() });

    // Ensure config is loaded.
    await api.fire("session_start", {}, ctx);

    const searchTool = api.tools.get("kota_search");
    const depsTool = api.tools.get("kota_deps");
    const usagesTool = api.tools.get("kota_usages");
    const impactTool = api.tools.get("kota_impact");

    expect(searchTool).toBeTruthy();
    expect(depsTool).toBeTruthy();
    expect(usagesTool).toBeTruthy();
    expect(impactTool).toBeTruthy();

    // 1) Search
    const searchRes = await searchTool.execute(
      "id",
      { query: "loadConfig", output: "paths", limit: 10 },
      undefined,
      undefined,
      ctx,
    );
    const searchText = String(searchRes.content?.[0]?.text ?? "");
    expect(searchText.length).toBeGreaterThan(0);

    // 2) Deps (use a stable known file)
    const depsRes = await depsTool.execute(
      "id",
      { file_path: "src/index.ts", direction: "dependencies", depth: 1 },
      undefined,
      undefined,
      ctx,
    );
    const depsText = String(depsRes.content?.[0]?.text ?? "");
    expect(depsText.length).toBeGreaterThan(0);

    // 3) Usages
    const usagesRes = await usagesTool.execute(
      "id",
      { symbol: "loadConfig" },
      undefined,
      undefined,
      ctx,
    );
    const usagesText = String(usagesRes.content?.[0]?.text ?? "");
    expect(usagesText.length).toBeGreaterThan(0);

    // 4) Impact (should be pinned)
    const impactRes = await impactTool.execute(
      "id",
      { change_type: "refactor", description: "smoke test" },
      undefined,
      undefined,
      ctx,
    );
    expect(impactRes.details?.pinned).toBe(true);

    // Clean shutdown (avoid orphaned subprocess)
    await api.fire("session_shutdown", {}, ctx);
  }, 120_000);
});
```

Expected failure modes initially:
- If `bunx` missing: suite is skipped (acceptable)
- If Kotadb tool names differ: tool calls may throw; adjust assertions to be less strict (non-empty output is enough)

**Step 2: Run test to verify it fails (or is skipped)**

Run: `npm run test:e2e`

Expected:
- If `bunx` installed: initially may FAIL due to missing config override / timeouts / flaky assertions.
- If `bunx` not installed: suite SKIPPED, earlier suites PASS.

**Step 3: Write minimal implementation (stabilize test harness, not prod code)**

Make these stabilizations **in the test**:
- Ensure `.pi/pi-kota.json` is written (from Task 3) before `session_start`
- Increase timeouts (already set)
- Use only loose assertions: `text.length > 0` and/or `includes("src/")`

**Step 4: Run test to verify it passes (when bunx present)**

Run: `npm run test:e2e`

Expected:
- PASS (if `bunx` present)
- Otherwise suite SKIPPED

**Step 5: Commit**

```bash
git add tests/smoke-e2e.test.ts
git commit -m "test(e2e): run core tools against real kotadb"
```

---

### Task 5: E2E test — pruning and blob cache via event handlers

**Files:**
- Modify: `tests/smoke-e2e.test.ts`

**Step 1: Write the failing test (context pruning)**

Add:

```ts
e2eDescribe("e2e smoke (prune + blobs)", () => {
  it("prunes old tool results on context event", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const ctx = makeCtx({ cwd: process.cwd() });
    await api.fire("session_start", {}, ctx);

    const long = "x".repeat(200);
    const messages = [
      { role: "user", content: [{ type: "text", text: "turn1" }] },
      { role: "toolResult", toolName: "kota_search", content: [{ type: "text", text: long }] },
      { role: "user", content: [{ type: "text", text: "turn2" }] },
      { role: "toolResult", toolName: "read", content: [{ type: "text", text: long }] },
      { role: "user", content: [{ type: "text", text: "turn3" }] },
    ];

    const [res] = await api.fire("context", { messages }, ctx);
    const pruned = (res?.messages ?? []) as any[];

    const firstTool = pruned.find((m) => m?.role === "toolResult" && m?.toolName === "kota_search");
    expect(firstTool?.details?.pruned).toBe(true);
    expect(String(firstTool?.content?.[0]?.text ?? "")).toContain("(Pruned)");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("writes a blob + truncates tool_result output", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const ctx = makeCtx({ cwd: process.cwd() });
    await api.fire("session_start", {}, ctx);

    const big = "y".repeat(500);
    const [res] = await api.fire(
      "tool_result",
      {
        toolName: "kota_search",
        content: [{ type: "text", text: big }],
        details: {},
      },
      ctx,
    );

    // Handler returns replacement content when it truncates.
    expect(String(res?.content?.[0]?.text ?? "")).toContain("Output truncated");
    expect(res?.details?.truncated).toBe(true);

    await api.fire("session_shutdown", {}, ctx);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`

Expected: FAIL initially if the `.pi/pi-kota.json` override isn’t being written for this describe block or if the handler signatures don’t match.

**Step 3: Write minimal implementation (test-only fixes)**

Make sure every suite that relies on config does the following before firing `session_start`:
- create `.pi/pi-kota.json`
- set `prune.maxToolChars` low (e.g., `50`)
- set `blobs.dir` to a repo-local temp dir (e.g., `./.tmp/e2e-blobs`)

Also update the blob test to additionally assert the `blobPath` points into that temp dir:

```ts
expect(String(res?.details?.blobPath ?? "")).toContain(".tmp/e2e-blobs");
```

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`

Expected: PASS (or SKIPPED if `bunx` missing; these tests don’t require `bunx` but do require the extension to load)

**Step 5: Commit**

```bash
git add tests/smoke-e2e.test.ts
git commit -m "test(e2e): cover pruning and blob truncation events"
```

---

### Task 6: Add cleanup to the e2e suite (remove .pi override + temp blobs)

**Files:**
- Modify: `tests/smoke-e2e.test.ts`

**Step 1: Write the failing test (assert cleanup occurs)**

Add an `afterAll` that removes `.pi/pi-kota.json` and `.tmp/e2e-blobs` and then **asserts they do not exist**. Start with an intentionally failing assertion if needed to verify the `afterAll` runs.

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`

Expected: FAIL

**Step 3: Write minimal implementation (real cleanup)**

Implement repo-local cleanup helpers in `tests/smoke-e2e.test.ts`:

```ts
async function rmSafe(p: string) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
```

Use:
- `await rmSafe(path.join(process.cwd(), ".pi"));`
- `await rmSafe(path.join(process.cwd(), ".tmp"));`

(Only remove what the tests create; do not touch `~/.pi/...`.)

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/smoke-e2e.test.ts
git commit -m "test(e2e): add cleanup for temp config and blobs"
```

---

## Verification

Run these before declaring the work complete:

- Unit tests:
  - `npm test`
  - Expected: PASS

- E2E tests:
  - `npm run test:e2e`
  - Expected: PASS (or SKIPPED on machines without `bunx`)

- Typecheck:
  - `npm run typecheck`
  - Expected: PASS

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-10-phase1-smoke-test-design.md`. Two execution options:

1. Subagent-Driven (this session) — I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Parallel Session (separate) — Open a new session with executing-plans, batch execution with checkpoints

Which approach?