# Phases 1, 4 & 5 — Finish & Package Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Complete the remaining phases (E2E verification, TUI status widget, packaging) to make pi-kota a publishable pi package.

**Architecture:** Phase 1 is already complete (8/8 e2e tests passing) — just needs roadmap sign-off. Phase 4 adds a richer status line using `ctx.ui.setStatus()` with themed output that updates on connection, indexing, and error state changes. Phase 5 converts the repo into a proper pi package with correct `package.json` metadata, peer dependencies, `files` field, CHANGELOG, and README updates.

**Tech Stack:** TypeScript (ESM), pi extension API (`setStatus`, `theme`), npm packaging.

---

### Task 1: Mark Phase 1 complete in roadmap

Phase 1 E2E smoke tests are fully passing (8/8 tests). The automated e2e suite covers: tool registration, session_start lifecycle, kota_search/deps/usages/impact against real KotaDB, pruning, blob truncation, handler wiring, and cleanup. This exceeds the original manual checklist.

**Files:**
- Modify: `docs/roadmap.md`

**Step 1: Update the roadmap checkboxes**

Change all Phase 1 `- [ ]` items to `- [x]` and add a note that automated e2e tests cover these scenarios.

**Step 2: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs: mark Phase 1 complete — all e2e smoke tests passing"
```

---

### Task 2: Enhance status line with themed output (Phase 4)

The extension already calls `ctx.ui.setStatus("pi-kota", ...)` in 3 places. Enhance this to show richer, themed status that updates on every state change.

**Files:**
- Create: `src/status.ts`
- Modify: `src/index.ts`
- Test: `tests/status.test.ts`

**Step 1: Write the failing test**

Create `tests/status.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { formatStatusLine } from "../src/status.js";

describe("formatStatusLine", () => {
  const noTheme = {
    fg: (_style: string, text: string) => text,
  };

  it("shows stopped state", () => {
    const line = formatStatusLine(
      { kotaStatus: "stopped", repoRoot: "/home/user/my-repo", indexed: false, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("stopped");
    expect(line).toContain("my-repo");
  });

  it("shows running + indexed state", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/home/user/my-repo", indexed: true, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("running");
    expect(line).toContain("indexed");
  });

  it("shows error state with message", () => {
    const line = formatStatusLine(
      { kotaStatus: "error", repoRoot: "/home/user/my-repo", indexed: false, lastError: "connect timeout" },
      noTheme as any,
    );
    expect(line).toContain("error");
    expect(line).toContain("connect timeout");
  });

  it("shows starting state", () => {
    const line = formatStatusLine(
      { kotaStatus: "starting", repoRoot: null, indexed: false, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("starting");
  });

  it("abbreviates long repo paths", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/very/long/path/to/my-project", indexed: true, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("my-project");
    expect(line).not.toContain("/very/long/path/to/");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/status.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/status.ts`**

```ts
import path from "node:path";

export interface StatusInfo {
  kotaStatus: "stopped" | "starting" | "running" | "error";
  repoRoot: string | null;
  indexed: boolean;
  lastError: string | null;
}

export interface StatusTheme {
  fg(style: string, text: string): string;
}

function abbreviateRepo(repoRoot: string | null): string {
  if (!repoRoot) return "(no repo)";
  return path.basename(repoRoot);
}

export function formatStatusLine(info: StatusInfo, theme: StatusTheme): string {
  const repo = abbreviateRepo(info.repoRoot);

  const stateIcons: Record<string, string> = {
    stopped: "○",
    starting: "◌",
    running: "●",
    error: "✖",
  };
  const stateColors: Record<string, string> = {
    stopped: "dim",
    starting: "dim",
    running: "success",
    error: "error",
  };

  const icon = theme.fg(stateColors[info.kotaStatus] ?? "dim", stateIcons[info.kotaStatus] ?? "?");
  const state = theme.fg(stateColors[info.kotaStatus] ?? "dim", info.kotaStatus);
  const repoText = theme.fg("dim", repo);

  const parts = [icon, state, theme.fg("dim", "|"), repoText];

  if (info.kotaStatus === "running") {
    const indexText = info.indexed
      ? theme.fg("success", "indexed")
      : theme.fg("warning", "not indexed");
    parts.push(theme.fg("dim", "|"), indexText);
  }

  if (info.kotaStatus === "error" && info.lastError) {
    const short = info.lastError.length > 40 ? info.lastError.slice(0, 40) + "…" : info.lastError;
    parts.push(theme.fg("dim", "|"), theme.fg("error", short));
  }

  return parts.join(" ");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/status.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/status.ts tests/status.test.ts
git commit -m "feat: add formatStatusLine for themed TUI status"
```

---

### Task 3: Wire formatStatusLine into index.ts

Replace the 3 inline `setStatus` calls with calls to the new `formatStatusLine`.

**Files:**
- Modify: `src/index.ts`

**Step 1: Add import and helper**

At the top of `src/index.ts`, add:

```ts
import { formatStatusLine } from "./status.js";
```

Add a helper inside the `export default function`:

```ts
  function updateStatus(ctx: { hasUI?: boolean; ui?: any }): void {
    if (!ctx.hasUI) return;
    const theme = ctx.ui.theme ?? { fg: (_s: string, t: string) => t };
    const info = {
      kotaStatus: state.kotaStatus,
      repoRoot: state.repoRoot,
      indexed: !!(state.repoRoot && state.indexedRepoRoot === normalizeRepoPath(state.repoRoot)),
      lastError: state.lastError,
    };
    ctx.ui.setStatus("pi-kota", formatStatusLine(info, theme));
  }
```

**Step 2: Replace existing setStatus calls**

Replace the 3 existing `ctx.ui.setStatus(...)` calls in:
1. `ensureConnected` success path (line ~108) → `updateStatus(ctx);`
2. `ensureConnected` error path (line ~118) → `updateStatus(ctx);`
3. `session_start` handler (line ~249) → `updateStatus(ctx);`

Also add `updateStatus(ctx)` at the end of:
4. `ensureRepoIndexed` — after indexing completes, status should show "indexed"
5. `callKotaTool` — after each successful tool call, refresh status (optional, may be noisy — only add if state changed)

**Step 3: Run all tests**

Run: `npm test && npm run test:e2e`
Expected: All pass. The e2e test asserts `combined.toContain("stopped")` which our new format still includes.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire themed status line into all state transitions"
```

---

### Task 4: Add status update on /kota restart and index commands

**Files:**
- Modify: `src/index.ts`

**Step 1: Add updateStatus calls in command handler**

In the `/kota restart` handler, after resetting state, add `updateStatus(ctx);`

In the `/kota index` handler, after indexing completes, add `updateStatus(ctx);`

**Step 2: Run tests**

Run: `npm test && npm run test:e2e`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: update status on /kota restart and /kota index"
```

---

### Task 5: Mark Phase 4 complete in roadmap

**Files:**
- Modify: `docs/roadmap.md`

**Step 1: Update Phase 4 checkboxes**

- [x] Status bar segment — `formatStatusLine` shows connection state, repo, index state
- [x] Live updates — `updateStatus()` called on connection change, index completion, errors
- [ ] Index progress — KotaDB doesn't surface progress events; skip for v0.1.0
- [x] Error indicator — error state shows red icon + truncated error message
- [x] Click/command integration — `/kota status` still works for full detail
- [x] Minimal footprint — single status line, no flicker

**Step 2: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs: mark Phase 4 mostly complete"
```

---

### Task 6: Package.json — remove private, add pi package metadata (Phase 5)

**Files:**
- Modify: `package.json`

**Step 1: Update package.json**

Apply these changes:
1. Remove `"private": true`
2. Set `"version": "0.1.0"`
3. Add `"keywords": ["pi-package"]`
4. Add `"repository"`, `"license"`, `"author"` fields
5. Move `@mariozechner/pi-coding-agent` and `@sinclair/typebox` from `dependencies` to `peerDependencies` with `"*"` range (per pi package spec)
6. Keep `@modelcontextprotocol/sdk` in `dependencies` (runtime dep, not provided by pi)
7. Add `"files"` field to control what gets published: `["src/", "scripts/", "docs/assets/", "README.md", "LICENSE"]`
8. Ensure `"pi"` section has correct extension path

The resulting `package.json` should look like:

```json
{
  "name": "pi-kota",
  "version": "0.1.0",
  "type": "module",
  "description": "KotaDB thin wrapper + context pruning extension for pi",
  "keywords": ["pi-package"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/coctostan/pi-kota"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "files": [
    "src/",
    "scripts/",
    "docs/assets/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "vitest run",
    "test:cov": "vitest run --coverage",
    "test:watch": "vitest",
    "test:e2e": "vitest run -c vitest.config.e2e.ts",
    "typecheck": "tsc --noEmit",
    "postinstall": "node scripts/check-bun.js"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "^0.52.9",
    "@sinclair/typebox": "^0.34.0",
    "@vitest/coverage-v8": "^2.1.9",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

Note: peer deps are also listed in `devDependencies` so `npm install` still works for local development.

**Step 2: Run tests to make sure nothing broke**

Run: `npm test && npm run test:e2e && npm run typecheck`
Expected: All PASS

**Step 3: Verify npm pack contents**

Run: `npm pack --dry-run 2>&1`
Expected: Only `src/`, `scripts/`, `docs/assets/`, `README.md`, `LICENSE`, `package.json` — no `tests/`, `coverage/`, `node_modules/`, `.tmp/`, `.kotadb/`

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: convert to pi package — version 0.1.0"
```

---

### Task 7: Create CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

**Step 1: Write CHANGELOG**

```markdown
# Changelog

## 0.1.0 — 2026-02-12

Initial release.

### Features

- **6 KotaDB tools**: `kota_index`, `kota_search`, `kota_deps`, `kota_usages`, `kota_impact`, `kota_task_context` — all output-bounded
- **5 commands**: `/kota status`, `/kota index`, `/kota restart`, `/kota reload-config`, `/kota evict-blobs`
- **Context pruning**: Removes stale tool output from older turns, with adaptive mode
- **Blob cache**: Large tool results truncated + full output saved for recovery
- **Auto-context injection**: Optional file-path detection in prompts triggers task context injection
- **MCP resilience**: Auto-reconnect, startup timeout, graceful shutdown, in-flight call draining
- **Config validation**: TypeBox validation with actionable error messages
- **Index staleness detection**: Warns when repo HEAD changes since last index
- **TUI status line**: Themed footer showing connection state, repo, and index status
- **Structured debug logging**: Opt-in JSONL logging for diagnosing MCP issues
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG for 0.1.0"
```

---

### Task 8: Update README install section

**Files:**
- Modify: `README.md`

**Step 1: Update the Install section**

Replace the current Install section with this updated version that leads with `pi install`:

```markdown
## 🚀 Install

### As a pi package (recommended)

```bash
pi install git:github.com/coctostan/pi-kota
```

Or add manually to `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):

```json
{
  "packages": ["git:github.com/coctostan/pi-kota"]
}
```

### Local development

```bash
git clone https://github.com/coctostan/pi-kota
cd pi-kota
npm install
```

Then point pi at it in `.pi/settings.json`:

```json
{
  "extensions": ["./path/to/pi-kota/src/index.ts"]
}
```
```

Remove the old "Manual (global)" symlink section — the package system handles this now.

**Step 2: Run typecheck (sanity)**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update install section for pi package"
```

---

### Task 9: Mark Phase 5 complete, final verification

**Files:**
- Modify: `docs/roadmap.md`

**Step 1: Update Phase 5 checkboxes**

Mark all completed items. "NPM publish" and "Install smoke test" remain unchecked — they happen after merge.

**Step 2: Run full verification**

```bash
npm test
npm run test:e2e
npm run typecheck
npm pack --dry-run
```

Expected: All pass. Pack shows only intended files.

**Step 3: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs: mark Phase 5 ready for publish"
```

---

## Verification

Run all of these before declaring done:

- `npm test` — PASS (133+ tests)
- `npm run test:e2e` — PASS (8+ tests)
- `npm run typecheck` — PASS
- `npm pack --dry-run` — only ships `src/`, `scripts/`, `docs/assets/`, `README.md`, `LICENSE`, `package.json`
- Verify `package.json` has no `"private": true`
- Verify version is `0.1.0`

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-12-phases-1-4-5-finish.md`. Two execution options:

1. **Subagent-Driven (this session)** — Fresh subagent per task with two-stage review. Better for plans with many independent tasks.

2. **Parallel Session (separate)** — Batch execution with human review checkpoints. Better when tasks are tightly coupled or you want more control between batches.

Which approach?
