# Phase 2/3 Hardening Follow-ups — Design (Post Code Review)

**Status:** Design-only. No implementation in this document.

## Context
A code review of branch `feat/phase2-3-hardening-tests` (range `5ccae22..2d5e461`) found the following gaps:

- **Critical:** `src/` line coverage below the plan target (observed ~82.84%; `src/index.ts` ~67.9%).
- **Important:** `ensureIndexed()` remains concurrency/race-prone (check-then-act without promise dedupe).
- **Important:** Logging can fail core flows (logger initialization/log writes are awaited and not isolated).

You requested **design-first** before any further changes.

## Goals (Must Achieve)

1) **Keep index staleness detection (must-keep)**
   - Track the git commit at which the repo was last indexed (`indexedAtCommit`).
   - Compare against current HEAD (`git rev-parse HEAD`).
   - When stale, show a user-facing nudge to re-index (UI notify when UI is present).

2) **Keep structured debug logging (must-keep)**
   - Opt-in JSONL logging to a file for diagnosing MCP/tool issues.
   - Logging must be *best effort* and **must never** break connection, tool calls, or lifecycle handlers.

3) **Coverage ≥ 90% on `src/`**
   - Achieve ≥90% line coverage on `src/`.
   - Prefer adding targeted tests over expanding production surface.
   - Optional policy: add Vitest coverage thresholds to prevent regression (see below).

4) **Concurrency-safe indexing**
   - Ensure concurrent calls do not trigger multiple indexing runs.

## Scope Decisions / De-scopes (Option 2)

To reduce side effects, risk, and test surface area while keeping must-haves:

- **De-scope:** *No automatic blob eviction on `session_start`*
  - Rationale: startup side effects create extra failure modes and test complexity.
  - Outcome: keep existing blob-writing for truncation, but do not evict automatically.

- **De-scope:** *No logging of tool args*
  - Rationale: args can be sensitive/noisy; JSON serialization can fail; larger logs.
  - Outcome: log tool name + outcome + duration/timing only.

## Proposed Architecture Changes (Minimal Extraction Refactor Style)

### Intent
Improve testability/coverage of `src/index.ts` without changing external behavior.

### Approach
Perform a **minimal extraction** refactor that:

- Keeps `export default function (pi: ExtensionAPI)` as the entry point.
- Extracts internal units that are easier to test in isolation.
- Makes dependencies injectable for tests (MCP client factory, git exec, logger factory, clock).

### Proposed internal structure

1) **`makeGitClient()` helper**
   - Functions:
     - `getRepoRoot(cwd): Promise<string>`
     - `getHeadCommit(repoRoot): Promise<string | null>`
   - Dependency: `pi.exec` (inject as `exec(cmd, args, opts)`)

2) **`makeLogger()` wrapper**
   - Returns a logger with safe semantics:
     - `safeLog(category, event, data?)` never throws
     - `safeClose()` never throws
   - Internally delegates to existing file logger (when enabled).

3) **`createToolCaller()`**
   - Wraps `callBudgeted()` + transport error handling.
   - Responsible for in-flight tracking (acquire/release).
   - Logging here should be non-fatal and must not include tool args.

4) **`createLifecycleHandlers()`**
   - Returns the handlers for:
     - `session_start`
     - `session_shutdown`
     - `before_agent_start`
     - `context`
     - `tool_result`
   - This enables wiring tests to call handlers directly without driving the full extension.

### Acceptance criteria for refactor
- No change in extension public API, tool names, or expected behavior.
- Coverage increase is achieved primarily via testability improvements.

## Logging Design (Best-Effort / Non-Fatal)

### Requirements
- Logger must **never** throw outward.
- If log file path is invalid/unwritable, core flows continue.

### Proposed semantics
- `createLogger()` returns either:
  - a file logger, or
  - a noop logger
- Any failure during:
  - logger creation
  - log write
  - logger close
  is caught and ignored (optionally tracked in memory for debugging).

### What to log (and what not to log)
- Log:
  - `mcp.connected`, `mcp.connect_error`, `mcp.disconnected`
  - `tool.call_start` (tool name only)
  - `tool.call_end` (tool name, ok flag, durationMs)
  - `index.stale_detected` (indexedAtCommit vs head)
- Do NOT log:
  - tool args
  - raw tool output

## ensureIndexed Concurrency Design

### Current risk
Two concurrent callers can both observe `indexed=false` and both run `index()`.

### Proposed fix
Add promise deduplication:

- Extend state to include an `indexPromise: Promise<void> | null`.
- In `ensureIndexed()`:
  - if `state.indexed` return
  - if `state.indexPromise` return `await state.indexPromise`
  - else set `state.indexPromise = (async () => { ...index...; state.indexed=true })()`
  - `finally` set `state.indexPromise=null` (but keep `indexed=true`)

### Test requirements
- Add a true concurrency test:
  - Arrange an `index()` function that waits on a barrier.
  - Call `Promise.all([ensureIndexed(...), ensureIndexed(...)])`.
  - Assert index called exactly once.

## Index Staleness Detection Design

### Behavior
- After a successful index, set `indexedAtCommit = HEAD` (from `git rev-parse HEAD`).
- Perform staleness detection **lazily on first real use** of an existing index (i.e., inside the “ensure index exists / open DB / run query” path), not on `session_start`.
- **Warning frequency:** warn at most **once per distinct repo `HEAD`** during a session.
  - Track `stalenessWarnedForHead: string | null` in session state.
  - On a “needs-index” operation:
    - `head = git rev-parse HEAD`
    - if `head` is null → do nothing (optionally debug-log) and continue (never crash)
    - if `head !== stalenessWarnedForHead` and `indexedAtCommit !== head`:
      - if UI exists: `notify("Repo HEAD has changed since last index. Re-index recommended.", "warning")`
      - emit `index.stale_detected` (best-effort log only)
      - set `stalenessWarnedForHead = head`
- If the current operation actually re-indexes, no stale warning is needed; update `indexedAtCommit = HEAD`.

### Testing
- Provide tests that cover:
  - stale vs not stale
  - UI vs no UI notify
  - warn-once-per-HEAD (two operations with same `HEAD` only notify once)
  - HEAD changes mid-session (new `HEAD` triggers notify again if still stale)
  - `git rev-parse HEAD` failure (null) should not crash

## Coverage Strategy (≥90% `src/`)

### Principle
Coverage should be improved by:
- Hitting meaningful branches with tests, not by adding trivial code.

### Target areas
- `src/index.ts` uncovered branches (typical):
  - connect error path
  - staleness notify path
  - restart/reset command path
  - tool_result ignore path
  - non-UI flows
  - logger failure path (create/log/close)

### Coverage enforcement (policy)
**Decision:** enforce coverage thresholds, but only on an explicit coverage run (keep `npm test` fast).

- Add a `test:cov` script that runs `vitest run --coverage`.
- Configure Vitest coverage thresholds (e.g. lines ≥ 90%, scoped to `src/**` or global).
- CI (when added) should gate on `npm run test:cov`.

## Implementation Plan (for later; not executed now)

1) Remove startup blob eviction + remove logging args (per de-scope)
2) Refactor `src/index.ts` via minimal extraction (no behavior changes)
3) Make logging best-effort (safe wrapper)
4) Add concurrency-safe ensureIndexed (promise dedupe)
5) Add targeted tests for `src/index.ts` branches
6) Re-run coverage and ensure ≥90% lines on `src/`

## Open Questions
- Staleness surface: keep UI notify-on-use as the primary UX. Also include staleness fields in existing `/kota status` output (UI-only) for debugging/visibility. No new tool/command surface for now.
- Coverage gating: add Vitest thresholds + `test:cov` script; enforce in CI via `npm run test:cov` (keep `npm test` unchanged).
