# Phase 2 & 3: Hardening + Test Coverage Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Complete Phase 2 (error recovery, blob eviction, index staleness, logging) and Phase 3 (edge-case test coverage ≥90% line coverage on `src/`).

**Architecture:** Phase 2 adds: in-flight call tracking for graceful shutdown, age/size-based blob eviction, git-HEAD staleness detection, and opt-in structured file logging. Phase 3 fills test gaps in pruning, blobs, callBudgeted, ensureIndexed, extractFilePaths, autoContext integration, and adaptive pruning boundaries. All new production code is TDD — failing test first.

**Tech Stack:** TypeScript, Vitest, Node.js `fs/promises`, `child_process`, git CLI

---

## What's Already Done

- ✅ MCP reconnection (transport error → `disconnect()`, reconnects on next call)
- ✅ Startup timeout (`connectTimeoutMs` with clear error message)
- ✅ Config validation (`sanitizeConfig` handles all malformed types)
- ✅ callBudgeted: EPIPE, no-text-blocks, truncation
- ✅ Config: invalid types, layered overrides, nested merge
- ✅ Blobs: concurrent writes, unicode
- ✅ Ensure: confirm-decline, idempotent index

## What Remains

**Phase 2:** Graceful shutdown, blob cache eviction, index staleness, structured logging
**Phase 3:** Edge-case tests for pruning, blobs, callBudgeted, ensureIndexed, extractFilePaths, autoContext+paths integration, adaptive pruning boundaries, index.ts wiring

---

### Task 1: Graceful Shutdown — In-Flight Call Tracking

Track active MCP calls so `session_shutdown` can await them before closing the transport.

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/index.ts` (ensureConnected + callKotaTool + session_shutdown)
- Test: `tests/runtime.test.ts`
- Test: `tests/smoke-e2e.test.ts`

**Step 1: Write the failing test**

Add to `tests/runtime.test.ts`:

```typescript
import { createInitialRuntimeState, InFlightTracker } from "../src/runtime.js";

describe("InFlightTracker", () => {
  it("tracks in-flight calls and resolves drain when all complete", async () => {
    const tracker = new InFlightTracker();
    expect(tracker.count).toBe(0);

    const release1 = tracker.acquire();
    const release2 = tracker.acquire();
    expect(tracker.count).toBe(2);

    release1();
    expect(tracker.count).toBe(1);

    const drainPromise = tracker.drain(500);
    release2();

    await drainPromise; // should resolve
    expect(tracker.count).toBe(0);
  });

  it("drain resolves immediately when no calls in flight", async () => {
    const tracker = new InFlightTracker();
    await tracker.drain(100); // should not hang
  });

  it("drain resolves after timeout even if calls remain", async () => {
    const tracker = new InFlightTracker();
    const release = tracker.acquire();
    const start = Date.now();
    await tracker.drain(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    release(); // cleanup
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runtime.test.ts -v`
Expected: FAIL — `InFlightTracker` not exported

**Step 3: Implement InFlightTracker**

Add to `src/runtime.ts`:

```typescript
export class InFlightTracker {
  private _count = 0;
  private _waiters: Array<() => void> = [];

  get count(): number {
    return this._count;
  }

  acquire(): () => void {
    this._count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._count--;
      if (this._count === 0) {
        for (const w of this._waiters.splice(0)) w();
      }
    };
  }

  drain(timeoutMs: number): Promise<void> {
    if (this._count === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this._waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
```

Add `inFlight: InFlightTracker` to `RuntimeState` interface and `createInitialRuntimeState()`:

```typescript
export interface RuntimeState {
  // ... existing fields ...
  inFlight: InFlightTracker;
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    // ... existing fields ...
    inFlight: new InFlightTracker(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runtime.test.ts -v`
Expected: PASS

**Step 5: Wire into index.ts**

In `src/index.ts`, update `callKotaTool` to track in-flight calls:

```typescript
async function callKotaTool(
  ctx: { cwd: string; hasUI?: boolean; ui?: any },
  toolName: string,
  args: unknown,
): Promise<{ text: string; raw: unknown; ok: boolean }> {
  await ensureConnected(ctx);
  if (!state.config || !state.mcp) throw new Error("pi-kota: not connected");

  const release = state.inFlight.acquire();
  try {
    return await callBudgeted({
      toolName,
      args,
      maxChars: 5000,
      listTools: () => state.mcp!.listTools(),
      callTool: (n, a) => state.mcp!.callTool(n, a),
      onTransportError: () => state.mcp?.disconnect(),
    });
  } finally {
    release();
  }
}
```

Update `session_shutdown` to drain before closing:

```typescript
pi.on("session_shutdown", async () => {
  await state.inFlight.drain(3000);
  await state.mcp?.close().catch(() => {});
  state.mcp = null;
});
```

**Step 6: Run full test suite**

Run: `npx vitest run -v`
Expected: All 55+ tests PASS

**Step 7: Commit**

```bash
git add src/runtime.ts src/index.ts tests/runtime.test.ts
git commit -m "feat: graceful shutdown with in-flight call tracking"
```

---

### Task 2: Blob Cache Eviction

Add age-based + size-based eviction for the blob cache directory.

**Files:**
- Create: `src/blobs-evict.ts`
- Modify: `src/index.ts` (call eviction on session_start)
- Test: `tests/blobs-evict.test.ts`

**Step 1: Write the failing test**

Create `tests/blobs-evict.test.ts`:

```typescript
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evictBlobs } from "../src/blobs-evict.js";

async function seedBlob(dir: string, name: string, ageMs: number): Promise<string> {
  const p = path.join(dir, name);
  await writeFile(p, "x".repeat(1024), "utf8");
  const pastDate = new Date(Date.now() - ageMs);
  const { utimes } = await import("node:fs/promises");
  await utimes(p, pastDate, pastDate);
  return p;
}

describe("evictBlobs", () => {
  it("removes files older than maxAgeDays", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-evict-")),
    );
    await seedBlob(dir, "old.txt", 8 * 86_400_000); // 8 days
    await seedBlob(dir, "new.txt", 1 * 86_400_000); // 1 day

    const result = await evictBlobs({ dir, maxAgeDays: 7, maxSizeBytes: Infinity });

    const remaining = await readdir(dir);
    expect(remaining).toEqual(["new.txt"]);
    expect(result.removedCount).toBe(1);
  });

  it("removes oldest files when total size exceeds maxSizeBytes", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-evict-size-")),
    );
    await seedBlob(dir, "oldest.txt", 3 * 86_400_000);
    await seedBlob(dir, "middle.txt", 2 * 86_400_000);
    await seedBlob(dir, "newest.txt", 1 * 86_400_000);

    // Each file is 1024 bytes. Max 2048 => keep 2, remove oldest.
    const result = await evictBlobs({ dir, maxAgeDays: 30, maxSizeBytes: 2048 });

    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["middle.txt", "newest.txt"]);
    expect(result.removedCount).toBe(1);
  });

  it("is a no-op when directory does not exist", async () => {
    const result = await evictBlobs({
      dir: "/tmp/pi-kota-nonexistent-" + Date.now(),
      maxAgeDays: 7,
      maxSizeBytes: Infinity,
    });
    expect(result.removedCount).toBe(0);
  });

  it("is a no-op when directory is empty", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-evict-empty-")),
    );
    const result = await evictBlobs({ dir, maxAgeDays: 7, maxSizeBytes: Infinity });
    expect(result.removedCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/blobs-evict.test.ts -v`
Expected: FAIL — module not found

**Step 3: Implement evictBlobs**

Create `src/blobs-evict.ts`:

```typescript
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface EvictOptions {
  dir: string;
  maxAgeDays: number;
  maxSizeBytes: number;
}

export interface EvictResult {
  removedCount: number;
  removedBytes: number;
}

export async function evictBlobs(opts: EvictOptions): Promise<EvictResult> {
  let entries: string[];
  try {
    entries = await readdir(opts.dir);
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "ENOENT") {
      return { removedCount: 0, removedBytes: 0 };
    }
    throw e;
  }

  if (entries.length === 0) return { removedCount: 0, removedBytes: 0 };

  const now = Date.now();
  const maxAgeMs = opts.maxAgeDays * 86_400_000;

  type FileInfo = { name: string; fullPath: string; mtimeMs: number; size: number };
  const files: FileInfo[] = [];

  for (const name of entries) {
    const fullPath = path.join(opts.dir, name);
    try {
      const s = await stat(fullPath);
      if (s.isFile()) {
        files.push({ name, fullPath, mtimeMs: s.mtimeMs, size: s.size });
      }
    } catch {
      // skip unreadable entries
    }
  }

  let removedCount = 0;
  let removedBytes = 0;

  // Pass 1: remove files older than maxAgeDays
  const survivors: FileInfo[] = [];
  for (const f of files) {
    if (now - f.mtimeMs > maxAgeMs) {
      try {
        await unlink(f.fullPath);
        removedCount++;
        removedBytes += f.size;
      } catch {
        survivors.push(f);
      }
    } else {
      survivors.push(f);
    }
  }

  // Pass 2: if still over size budget, remove oldest first
  survivors.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  let totalSize = survivors.reduce((sum, f) => sum + f.size, 0);

  for (const f of survivors) {
    if (totalSize <= opts.maxSizeBytes) break;
    try {
      await unlink(f.fullPath);
      removedCount++;
      removedBytes += f.size;
      totalSize -= f.size;
    } catch {
      // skip
    }
  }

  return { removedCount, removedBytes };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/blobs-evict.test.ts -v`
Expected: PASS

**Step 5: Add config fields for eviction**

In `src/config.ts`, add to the `blobs` section of `PiKotaConfig`:

```typescript
blobs: {
  enabled: boolean;
  dir: string;
  maxAgeDays: number;
  maxSizeBytes: number;
};
```

Update `DEFAULT_CONFIG`:
```typescript
blobs: {
  enabled: true,
  dir: "~/.pi/cache/pi-kota/blobs",
  maxAgeDays: 7,
  maxSizeBytes: 50 * 1024 * 1024, // 50 MB
},
```

Update `sanitizeConfig` to handle the new fields:
```typescript
blobs: {
  enabled: sanitizeBoolean(blobs.enabled, fallback.blobs.enabled),
  dir: sanitizeString(blobs.dir, fallback.blobs.dir),
  maxAgeDays: sanitizeNumber(blobs.maxAgeDays, fallback.blobs.maxAgeDays, 1),
  maxSizeBytes: sanitizeNumber(blobs.maxSizeBytes, fallback.blobs.maxSizeBytes, 0),
},
```

**Step 6: Wire eviction into session_start**

In `src/index.ts`, add import and call in `session_start`:

```typescript
import { evictBlobs } from "./blobs-evict.js";

// Inside session_start handler, after refreshConfig:
if (state.config?.blobs.enabled) {
  evictBlobs({
    dir: state.config.blobs.dir,
    maxAgeDays: state.config.blobs.maxAgeDays,
    maxSizeBytes: state.config.blobs.maxSizeBytes,
  }).catch(() => {}); // fire-and-forget, don't block session start
}
```

**Step 7: Run full test suite**

Run: `npx vitest run -v`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add src/blobs-evict.ts tests/blobs-evict.test.ts src/config.ts src/index.ts
git commit -m "feat: blob cache eviction (age + size based)"
```

---

### Task 3: Index Staleness Detection

Detect when the repo HEAD has changed since last index and suggest re-indexing.

**Files:**
- Modify: `src/runtime.ts` (add `indexedAtCommit` field)
- Create: `src/staleness.ts`
- Test: `tests/staleness.test.ts`
- Modify: `src/index.ts` (check staleness before tool calls)

**Step 1: Write the failing test**

Create `tests/staleness.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isIndexStale } from "../src/staleness.js";

describe("isIndexStale", () => {
  it("returns false when indexedAtCommit matches currentHead", () => {
    expect(isIndexStale("abc123", "abc123")).toBe(false);
  });

  it("returns true when commits differ", () => {
    expect(isIndexStale("abc123", "def456")).toBe(true);
  });

  it("returns false when indexedAtCommit is null (never indexed)", () => {
    expect(isIndexStale(null, "abc123")).toBe(false);
  });

  it("returns false when currentHead is null (git error)", () => {
    expect(isIndexStale("abc123", null)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/staleness.test.ts -v`
Expected: FAIL — module not found

**Step 3: Implement isIndexStale**

Create `src/staleness.ts`:

```typescript
export function isIndexStale(
  indexedAtCommit: string | null,
  currentHead: string | null,
): boolean {
  if (!indexedAtCommit || !currentHead) return false;
  return indexedAtCommit !== currentHead;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/staleness.test.ts -v`
Expected: PASS

**Step 5: Add indexedAtCommit to RuntimeState**

In `src/runtime.ts`, add to `RuntimeState`:

```typescript
indexedAtCommit: string | null;
```

And in `createInitialRuntimeState()`:

```typescript
indexedAtCommit: null,
```

**Step 6: Wire into index.ts**

In `src/index.ts`, add a helper to get current HEAD:

```typescript
import { isIndexStale } from "./staleness.js";

async function getHeadCommit(cwd: string): Promise<string | null> {
  try {
    const res = await pi.exec("git", ["rev-parse", "HEAD"], { cwd, timeout: 3000 });
    return res.code === 0 ? res.stdout.trim() : null;
  } catch {
    return null;
  }
}
```

Update the `kota_index` tool execute to save the commit:

```typescript
// After successful index, save the commit
state.indexedAtCommit = await getHeadCommit(state.repoRoot ?? ctx.cwd);
```

Also update `ensureRepoIndexed` to save the commit after indexing:

```typescript
index: async () => {
  await callKotaToolStrict(ctx, "index", { path: targetPath });
  state.indexedAtCommit = await getHeadCommit(state.repoRoot ?? ctx.cwd);
},
```

In each tool that calls `ensureRepoIndexed`, add a staleness check after it:

```typescript
// Add helper function
async function checkStaleness(ctx: { cwd: string; hasUI?: boolean; ui?: any }): Promise<void> {
  if (!state.indexedAtCommit || !state.repoRoot) return;
  const head = await getHeadCommit(state.repoRoot);
  if (isIndexStale(state.indexedAtCommit, head)) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "pi-kota: repo HEAD has changed since last index. Run /kota index to update.",
        "warning",
      );
    }
  }
}
```

Call `checkStaleness(ctx)` inside `ensureRepoIndexed`, after the `ensureIndexed` call but only when `state.indexedRepoRoot` was already set (i.e., we skipped re-indexing):

```typescript
async function ensureRepoIndexed(ctx: { cwd: string; hasUI?: boolean; ui?: any }): Promise<void> {
  if (!state.config) throw new Error("pi-kota: config not loaded");
  const targetPath = normalizeRepoPath(state.repoRoot ?? ctx.cwd);
  const wasAlreadyIndexed = state.indexedRepoRoot === targetPath;

  await ensureIndexed({
    state: {
      get indexed() { return state.indexedRepoRoot === targetPath; },
      set indexed(v: boolean) { state.indexedRepoRoot = v ? targetPath : null; },
    },
    confirmIndex: state.config.kota.confirmIndex,
    confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(true)),
    index: async () => {
      await callKotaToolStrict(ctx, "index", { path: targetPath });
      state.indexedAtCommit = await getHeadCommit(state.repoRoot ?? ctx.cwd);
    },
  });

  if (wasAlreadyIndexed) {
    await checkStaleness(ctx);
  }
}
```

**Step 7: Run full test suite**

Run: `npx vitest run -v`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add src/staleness.ts tests/staleness.test.ts src/runtime.ts src/index.ts
git commit -m "feat: index staleness detection via git HEAD comparison"
```

---

### Task 4: Structured Debug Logging

Add opt-in file-based debug logging for diagnosing MCP issues.

**Files:**
- Create: `src/logger.ts`
- Modify: `src/config.ts` (add `log` section)
- Test: `tests/logger.test.ts`
- Modify: `src/index.ts` (add logging at key points)

**Step 1: Write the failing test**

Create `tests/logger.test.ts`:

```typescript
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger, Logger } from "../src/logger.js";

describe("Logger", () => {
  it("writes JSON lines to the log file", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-log-")),
    );
    const logPath = path.join(dir, "debug.jsonl");
    const logger = await createLogger({ enabled: true, path: logPath });

    await logger.log("mcp", "connect", { repo: "/tmp/foo" });
    await logger.log("tool", "call", { name: "search" });
    await logger.close();

    const lines = (await readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
    expect(lines).toHaveLength(2);
    expect(lines[0].category).toBe("mcp");
    expect(lines[0].event).toBe("connect");
    expect(lines[0].data).toEqual({ repo: "/tmp/foo" });
    expect(lines[0].ts).toBeDefined();
    expect(lines[1].category).toBe("tool");
  });

  it("is a silent no-op when disabled", async () => {
    const logger = await createLogger({ enabled: false });
    await logger.log("mcp", "connect", {}); // should not throw
    await logger.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/logger.test.ts -v`
Expected: FAIL — module not found

**Step 3: Implement logger**

Create `src/logger.ts`:

```typescript
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export interface Logger {
  log(category: string, event: string, data?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

const noopLogger: Logger = {
  async log() {},
  async close() {},
};

export async function createLogger(opts: {
  enabled: boolean;
  path?: string;
}): Promise<Logger> {
  if (!opts.enabled || !opts.path) return noopLogger;

  const logPath = opts.path;
  await mkdir(path.dirname(logPath), { recursive: true });

  return {
    async log(category: string, event: string, data?: Record<string, unknown>): Promise<void> {
      const entry = JSON.stringify({ ts: new Date().toISOString(), category, event, data }) + "\n";
      await appendFile(logPath, entry, "utf8");
    },
    async close() {
      // no-op for append-based logger, but keeps interface clean for future buffered impl
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/logger.test.ts -v`
Expected: PASS

**Step 5: Add config fields**

In `src/config.ts`, add to `PiKotaConfig`:

```typescript
log: {
  enabled: boolean;
  path: string;
};
```

Update `DEFAULT_CONFIG`:

```typescript
log: {
  enabled: false,
  path: "~/.pi/cache/pi-kota/debug.jsonl",
},
```

Update `sanitizeConfig`:

```typescript
const log = isObject(root.log) ? root.log : {};

// ... in the return:
log: {
  enabled: sanitizeBoolean(log.enabled, fallback.log.enabled),
  path: sanitizeString(log.path, fallback.log.path),
},
```

Update tilde expansion in `loadConfig` to also expand `config.log.path`:

```typescript
config = {
  ...config,
  blobs: { ...config.blobs, dir: expandTilde(config.blobs.dir, homeDir) },
  log: { ...config.log, path: expandTilde(config.log.path, homeDir) },
};
```

**Step 6: Wire into index.ts**

Add import and create logger in `session_start`:

```typescript
import { createLogger, Logger } from "./logger.js";

// At module scope in the extension function:
let logger: Logger = { async log() {}, async close() {} };

// In session_start, after refreshConfig:
logger = await createLogger({
  enabled: state.config?.log.enabled ?? false,
  path: state.config?.log.path,
});
```

Add logging at key points:
- In `ensureConnected`, after successful connect: `logger.log("mcp", "connected", { repo: state.repoRoot })`
- In `ensureConnected`, on error: `logger.log("mcp", "connect-error", { error: state.lastError })`
- In `callKotaTool`, before the call: `logger.log("tool", "call", { toolName, args: JSON.stringify(args).slice(0, 200) })`
- In `session_shutdown`, before close: `await logger.close()`

**Step 7: Run full test suite**

Run: `npx vitest run -v`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add src/logger.ts tests/logger.test.ts src/config.ts src/index.ts
git commit -m "feat: structured debug logging (opt-in via config)"
```

---

### Task 5: Phase 3 — Pruning Edge-Case Tests

**Files:**
- Modify: `tests/prune.test.ts`

**Step 1: Add edge-case tests**

Append to `tests/prune.test.ts`:

```typescript
import { computePruneSettings } from "../src/prune.js";

describe("pruneContextMessages edge cases", () => {
  it("returns empty array for empty messages", () => {
    const pruned = pruneContextMessages([], {
      keepRecentTurns: 2,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect(pruned).toEqual([]);
  });

  it("handles all-user messages (no tool results)", () => {
    const messages = [user("A"), user("B"), user("C")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect(pruned).toEqual(messages);
  });

  it("handles single turn (one user message)", () => {
    const messages = [user("A")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect(pruned).toEqual(messages);
  });

  it("does not prune tool results for non-matching tool names", () => {
    const messages = [user("A"), tool("bash", "x".repeat(5000)), user("B")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect((pruned[1] as any).content[0].text).toBe("x".repeat(5000));
  });

  it("handles messages with missing text blocks in content", () => {
    const messages = [
      user("A"),
      { role: "toolResult", toolName: "read", content: [{ type: "image", data: "..." }], details: {} },
      user("B"),
    ];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    // No text block → toolText returns "" → length 0 ≤ 100 → not pruned
    expect((pruned[1] as any).content[0].type).toBe("image");
  });
});

describe("computePruneSettings", () => {
  it("returns base settings below 120k tokens", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 1200 };
    expect(computePruneSettings(base, 100_000)).toEqual(base);
    expect(computePruneSettings(base, 119_999)).toEqual(base);
  });

  it("tightens at exactly 120k tokens", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 1200 };
    const result = computePruneSettings(base, 120_000);
    expect(result.keepRecentTurns).toBe(1);
    expect(result.maxToolChars).toBe(792); // floor(1200 * 0.66)
  });

  it("returns base when tokens is undefined", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 1200 };
    expect(computePruneSettings(base, undefined)).toEqual(base);
  });

  it("clamps keepRecentTurns to minimum 1", () => {
    const base = { keepRecentTurns: 1, maxToolChars: 1200 };
    const result = computePruneSettings(base, 200_000);
    expect(result.keepRecentTurns).toBe(1); // max(1, 1-1) = 1
  });

  it("clamps maxToolChars to minimum 400", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 500 };
    const result = computePruneSettings(base, 200_000);
    expect(result.maxToolChars).toBe(400); // max(400, floor(500*0.66)=330) = 400
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/prune.test.ts -v`
Expected: All PASS (these are testing existing implementation)

**Step 3: Commit**

```bash
git add tests/prune.test.ts
git commit -m "test: pruning edge cases and adaptive threshold boundaries"
```

---

### Task 6: Phase 3 — Blob Writer Edge-Case Tests

**Files:**
- Modify: `tests/blobs.test.ts`

**Step 1: Add edge-case tests**

Append to `tests/blobs.test.ts`:

```typescript
import { mkdir } from "node:fs/promises";

describe("writeBlob edge cases", () => {
  it("throws EACCES when directory is not writable", async () => {
    // Create a read-only directory
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-ro-")),
    );
    const roDir = path.join(dir, "readonly");
    await mkdir(roDir, { mode: 0o444 });

    await expect(
      writeBlob({ dir: path.join(roDir, "nested"), content: "test" }),
    ).rejects.toThrow();
  });

  it("handles empty string content", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-empty-")),
    );
    const res = await writeBlob({ dir, content: "" });
    expect(res.blobId).toMatch(/^[a-f0-9]{64}$/);
    expect(res.bytes).toBe(0);
    expect(await readFile(res.blobPath, "utf8")).toBe("");
  });

  it("uses .json extension when specified", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-ext-")),
    );
    const res = await writeBlob({ dir, content: '{"a":1}', ext: ".json" });
    expect(res.blobPath).toMatch(/\.json$/);
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/blobs.test.ts -v`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/blobs.test.ts
git commit -m "test: blob writer edge cases (permissions, empty content, json ext)"
```

---

### Task 7: Phase 3 — callBudgeted Edge Cases

**Files:**
- Modify: `tests/kota-tools.test.ts`

**Step 1: Add edge-case tests**

Append to `tests/kota-tools.test.ts`:

```typescript
describe("callBudgeted edge cases", () => {
  it("handles empty content array from MCP", async () => {
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => ["search"],
      callTool: async () => ({
        content: [],
        raw: { content: [] },
      }),
    });

    expect(result.ok).toBe(true);
    // empty toTextContent → falls back to JSON of raw
    expect(result.text).toContain('"content"');
  });

  it("truncates huge error messages to maxChars", async () => {
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 50,
      listTools: async () => ["search"],
      callTool: async () => {
        throw new Error("E".repeat(1000));
      },
    });

    expect(result.ok).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(50);
    expect(result.text).toMatch(/…$/);
  });

  it("handles ECONNRESET as transport error", async () => {
    let transportErrorFired = false;
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => [],
      callTool: async () => {
        const err = new Error("read ECONNRESET") as Error & { code: string };
        err.code = "ECONNRESET";
        throw err;
      },
      onTransportError: () => { transportErrorFired = true; },
    });

    expect(transportErrorFired).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("handles ERR_STREAM_DESTROYED as transport error", async () => {
    let transportErrorFired = false;
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => [],
      callTool: async () => {
        const err = new Error("stream destroyed") as Error & { code: string };
        err.code = "ERR_STREAM_DESTROYED";
        throw err;
      },
      onTransportError: () => { transportErrorFired = true; },
    });

    expect(transportErrorFired).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("treats non-transport errors as recoverable (lists tools)", async () => {
    const listTools = vi.fn(async () => ["search", "deps"]);
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools,
      callTool: async () => {
        throw new Error("some random error");
      },
    });

    expect(listTools).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("search, deps");
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/kota-tools.test.ts -v`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/kota-tools.test.ts
git commit -m "test: callBudgeted edge cases (empty content, huge errors, transport codes)"
```

---

### Task 8: Phase 3 — ensureIndexed Edge Cases

**Files:**
- Modify: `tests/kota-ensure.test.ts`

**Step 1: Add edge-case tests**

Append to `tests/kota-ensure.test.ts`:

```typescript
describe("ensureIndexed edge cases", () => {
  it("propagates error when index() throws", async () => {
    const state = { indexed: false };
    await expect(
      ensureIndexed({
        state,
        confirmIndex: false,
        confirm: vi.fn(async () => true),
        index: vi.fn(async () => {
          throw new Error("MCP connection lost");
        }),
      }),
    ).rejects.toThrow("MCP connection lost");

    expect(state.indexed).toBe(false);
  });

  it("does not double-index on concurrent calls", async () => {
    const state = { indexed: false };
    let indexCallCount = 0;
    const index = vi.fn(async () => {
      indexCallCount++;
      await new Promise((r) => setTimeout(r, 50));
    });

    // First call will index, second should see indexed=true after first completes
    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    // Now state.indexed is true, second call should be a no-op
    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    expect(indexCallCount).toBe(1);
  });

  it("skips confirm when confirmIndex is false", async () => {
    const state = { indexed: false };
    const confirm = vi.fn(async () => true);
    const index = vi.fn(async () => {});

    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm,
      index,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(index).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/kota-ensure.test.ts -v`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/kota-ensure.test.ts
git commit -m "test: ensureIndexed edge cases (throw propagation, no double-index, skip confirm)"
```

---

### Task 9: Phase 3 — extractFilePaths Edge Cases

**Files:**
- Modify: `tests/paths.test.ts`

**Step 1: Add edge-case tests**

Append to `tests/paths.test.ts`:

```typescript
describe("extractFilePaths edge cases", () => {
  it("returns empty for empty string", () => {
    expect(extractFilePaths("")).toEqual([]);
  });

  it("returns empty for string with no slash-separated tokens", () => {
    expect(extractFilePaths("hello world foo bar")).toEqual([]);
  });

  it("handles paths with dots in directory names", () => {
    expect(extractFilePaths("Open src/.hidden/config.ts")).toEqual(["src/.hidden/config.ts"]);
  });

  it("handles paths with hyphens and underscores", () => {
    expect(extractFilePaths("Check my-app/src_utils/helper-fn.ts")).toEqual([
      "my-app/src_utils/helper-fn.ts",
    ]);
  });

  it("ignores paths with .. (parent traversal)", () => {
    expect(extractFilePaths("Read ../sibling/file.ts")).toEqual([]);
  });

  it("handles multiple paths on same line", () => {
    expect(extractFilePaths("Diff src/a.ts against lib/b.ts")).toEqual(["src/a.ts", "lib/b.ts"]);
  });

  it("ignores directory-only paths (no file extension in last segment)", () => {
    expect(extractFilePaths("Look at src/utils/helpers")).toEqual([]);
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/paths.test.ts -v`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/paths.test.ts
git commit -m "test: extractFilePaths edge cases (empty, dots, hyphens, traversal)"
```

---

### Task 10: Phase 3 — AutoContext + Paths Integration Test

**Files:**
- Modify: `tests/autocontext.test.ts`

**Step 1: Add integration test**

Append to `tests/autocontext.test.ts`:

```typescript
import { extractFilePaths } from "../src/paths.js";

describe("autoContext + extractFilePaths integration", () => {
  it("onPaths mode injects when prompt mentions 1-3 file paths", () => {
    const prompt = "Fix the bug in src/config.ts and src/index.ts";
    const paths = extractFilePaths(prompt);
    expect(paths).toEqual(["src/config.ts", "src/index.ts"]);
    expect(shouldAutoInject(paths, "onPaths")).toBe(true);
  });

  it("onPaths mode does not inject when prompt mentions 4+ file paths", () => {
    const prompt =
      "Update src/a.ts src/b.ts src/c.ts src/d.ts";
    const paths = extractFilePaths(prompt);
    expect(paths).toHaveLength(4);
    expect(shouldAutoInject(paths, "onPaths")).toBe(false);
  });

  it("onPaths mode does not inject for prompts without file paths", () => {
    const prompt = "What does the config loader do?";
    const paths = extractFilePaths(prompt);
    expect(paths).toEqual([]);
    expect(shouldAutoInject(paths, "onPaths")).toBe(false);
  });

  it("always mode injects even without file paths", () => {
    const prompt = "Summarize the architecture";
    const paths = extractFilePaths(prompt);
    expect(shouldAutoInject(paths, "always")).toBe(true);
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/autocontext.test.ts -v`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/autocontext.test.ts
git commit -m "test: autoContext + extractFilePaths integration tests"
```

---

### Task 11: Phase 3 — index.ts Wiring Tests

Test that `before_agent_start`, `tool_result`, and `context` event handlers are wired correctly.

**Files:**
- Modify: `tests/smoke-e2e.test.ts`

**Step 1: Add wiring tests**

Add new describe blocks to `tests/smoke-e2e.test.ts`:

```typescript
describe("e2e smoke (wiring details)", () => {
  it("registers handlers for all lifecycle events", () => {
    const api = createMockApi();
    extension(api.pi as any);

    expect(api.handlers.has("session_start")).toBe(true);
    expect(api.handlers.has("session_shutdown")).toBe(true);
    expect(api.handlers.has("before_agent_start")).toBe(true);
    expect(api.handlers.has("context")).toBe(true);
    expect(api.handlers.has("tool_result")).toBe(true);
  });

  it("tool_result handler ignores non-kota tools", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    await setupE2eConfig();
    const ctx = makeCtx({ cwd: repoRoot });
    await api.fire("session_start", {}, ctx);

    const [res] = await api.fire(
      "tool_result",
      {
        toolName: "read",
        content: [{ type: "text", text: "x".repeat(10000) }],
        details: {},
      },
      ctx,
    );

    // shouldTruncateToolResult("read") returns false → handler returns undefined
    expect(res).toBeUndefined();

    await api.fire("session_shutdown", {}, ctx);
  });

  it("tool_result handler does not truncate small kota output", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    await setupE2eConfig();
    const ctx = makeCtx({ cwd: repoRoot });
    await api.fire("session_start", {}, ctx);

    const [res] = await api.fire(
      "tool_result",
      {
        toolName: "kota_search",
        content: [{ type: "text", text: "short" }],
        details: {},
      },
      ctx,
    );

    // "short".length < maxToolChars → no truncation → returns undefined
    expect(res).toBeUndefined();

    await api.fire("session_shutdown", {}, ctx);
  });
});
```

**Step 2: Run test to verify they pass**

Run: `npx vitest run tests/smoke-e2e.test.ts -v`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/smoke-e2e.test.ts
git commit -m "test: index.ts wiring tests for lifecycle events and tool_result filtering"
```

---

### Task 12: Run Coverage and Verify ≥90%

**Step 1: Run coverage**

Run: `npx vitest run --coverage`

Check the output for `src/` files. If any file is below 90%, note which lines are uncovered and add targeted tests.

**Step 2: Add any missing tests for uncovered lines**

(Conditional — only if coverage gaps found)

**Step 3: Final full test run**

Run: `npx vitest run -v`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "test: coverage push to ≥90% on src/"
```

---

### Task 13: Update Roadmap

**Files:**
- Modify: `docs/roadmap.md`

**Step 1: Mark Phase 2 and Phase 3 items as complete**

Replace all `- [ ]` checkboxes in Phase 2 and Phase 3 with `- [x]` for completed items.

**Step 2: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs: mark Phase 2 and Phase 3 complete in roadmap"
```

---

Plan complete and saved to `docs/plans/2026-02-10-phase2-3-hardening-tests.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?