# pi-kota Roadmap

> Post-MVP roadmap. The core extension (tools, pruning, blob cache, autoContext) is implemented and passing all tests. These phases take it from "works on my machine" to "shippable package."

---

## Phase 1 — End-to-End Smoke Test

**Goal:** Prove the extension works in a live pi session against a real KotaDB instance.

- [x] Verify `bun` available (install if needed)
- [x] Launch pi with `-e ./src/index.ts`, confirm status bar shows `kota: stopped`
- [x] `/kota status` — prints config sources, repo root, connection state
- [x] `/kota index` — confirmation dialog fires, indexing completes
- [x] LLM calls `kota_search` — bounded output returned, no crash
- [x] LLM calls `kota_deps` / `kota_usages` — correct results for known repo files
- [x] `kota_impact` result has `pinned: true` in details
- [x] Trigger 10+ tool calls — verify older results are pruned in context
- [x] Verify blob cache: large `kota_search` result produces `~/.pi/cache/pi-kota/blobs/<sha>.txt`
- [x] `/kota restart` — reconnects cleanly on next tool call
- [x] Document any bugs found → feed into Phase 2

**Note:** Automated e2e smoke tests cover these scenarios and are passing.

**Exit criteria:** All commands and tools work end-to-end with no unhandled errors.

---

## Phase 2 — Hardening & Error Recovery

**Goal:** Make the MCP connection resilient and degrade gracefully under real-world conditions.

- [x] **MCP reconnection** — detect broken pipe / unexpected close, auto-reconnect on next tool call
- [x] **Startup timeout** — if KotaDB takes >10s to connect, surface a clear error + retry path
- [x] **Graceful shutdown** — `session_shutdown` handler waits for in-flight MCP calls before closing
- [x] **Partial failure** — if one MCP call fails mid-session, don't poison the whole connection
- [x] **Config validation** — reject malformed `pi-kota.json` with actionable error messages (TypeBox validation)
- [x] **Blob cache cleanup** — age-based eviction (configurable max age / max size)
- [x] **Index staleness** — detect repo changes since last index, suggest re-index
- [x] **Logging** — structured debug logging (opt-in via config) for diagnosing MCP issues

**Exit criteria:** Extension survives KotaDB crash, network hiccup, bad config, and long-running sessions without manual intervention.

---

## Phase 3 — Test Coverage Expansion

**Goal:** Cover integration paths and edge cases that unit tests don't reach.

- [x] **`index.ts` wiring tests** — mock `ExtensionAPI`, verify event handlers register and fire correctly
- [x] **Pruning edge cases** — empty messages array, all-user messages, single turn, messages with no text blocks
- [x] **Config edge cases** — missing fields, extra fields, invalid types, nested override merge conflicts
- [x] **Blob writer edge cases** — permission errors, disk full simulation, concurrent writes to same hash
- [x] **`callBudgeted` edge cases** — MCP returns empty content, non-text content blocks, huge error messages
- [x] **`ensureIndexed` edge cases** — confirm returns false, index throws, double-call race condition
- [x] **`extractFilePaths` edge cases** — deeply nested paths, paths with special chars, Windows-style paths in mixed content
- [x] **AutoContext integration** — `shouldAutoInject` + `extractFilePaths` combined with various prompt shapes
- [x] **Adaptive pruning** — verify `computePruneSettings` thresholds produce correct tightened values at boundary token counts

**Exit criteria:** ≥90% line coverage on `src/`, all edge cases from smoke test bugs covered.

---

## Phase 4 — TUI Status Widget

**Goal:** Give the user real-time visibility into kota state without running `/kota status`.

- [ ] **Status bar segment** — persistent footer widget showing: connection state (`stopped`/`starting`/`running`/`error`), repo root (abbreviated), index state (`indexed`/`not indexed`)
- [ ] **Live updates** — widget refreshes on connection change, index completion, errors
- [ ] **Index progress** — if KotaDB provides progress events, surface a progress indicator during indexing
- [ ] **Error indicator** — red/yellow state when last MCP call failed, with one-line error summary
- [ ] **Click/command integration** — `/kota` opens a detail panel or cycles through status info
- [ ] **Minimal footprint** — widget should be ≤1 line, no flicker, no layout disruption

**Exit criteria:** User can glance at the footer and know kota's state at all times.

---

## Phase 5 — Package & Publish

**Goal:** Make pi-kota installable via `pi install pi-kota`.

- [ ] **Package manifest** — add pi package metadata to `package.json` (following pi package spec)
- [ ] **Version bump** — `0.1.0` for first public release
- [ ] **Entry point validation** — ensure `pi.extensions` path resolves correctly when installed globally
- [ ] **Peer dependency ranges** — verify compat with current pi-coding-agent versions
- [ ] **Install smoke test** — `pi install pi-kota` from a clean environment, verify tools register
- [ ] **Uninstall** — `pi uninstall pi-kota` cleans up cleanly
- [ ] **NPM publish** — publish to npm registry
- [ ] **README install section** — update with `pi install pi-kota` as primary install method
- [ ] **CHANGELOG.md** — create with 0.1.0 entry summarizing all features

**Exit criteria:** `pi install pi-kota` works, tools appear, `/kota status` runs — zero manual setup beyond having `bun` installed.
