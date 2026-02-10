# pi-kota design

> Source: originally drafted in `/home/pi/docs/plans/2026-02-10-pi-kota-extension-design.md`.

---
name: pi-kota-extension-design
date: 2026-02-10
status: draft
owners:
  - you
---

> **Note:** This is a draft design document (includes some aspirational UX/commands). For current shipped behavior, use `README.md` and `src/*` as source of truth.

# pi-kota: KotaDB thin wrapper + context pruning (pi extension)

## 1. Summary
`pi-kota` is a **pi extension** that integrates **KotaDB** (local TS/JS code intelligence via SQLite + dependency graph + symbol index) into pi as a small set of **bounded-output tools**, and adds **runtime context governance** to prevent multi-turn sessions from accumulating large tool outputs.

Core idea:
- **KotaDB = brain** (persistent index/graph outside the LLM context)
- **pi extension = governor** (tool curation, output budgets, pruning, rehydration)

The extension targets **TypeScript/JavaScript repositories**.

## 2. Problem
In large TS/JS repos, agent sessions degrade because:
- answers require repeatedly pulling large files/snippets into the conversation
- tool outputs (reads/search results) persist across turns, causing linear context growth
- compaction triggers more often and can lose important details

## 3. Goals / Success criteria
### 3.1 Goals
- Provide **fast, dependency-aware retrieval** (deps, dependents, usages, impact) without reading entire files into context.
- Enforce **bounded outputs by default** (paths/compact/snippet-first).
- Prevent context bloat by **pruning older tool results** while preserving meaning and rehydration paths.
- Keep integration **thin**: reuse KotaDB; avoid reimplementing index/graph logic.

### 3.2 Success criteria (measurable)
- Typical graph queries (deps/usages/impact) add **<5KB** to context.
- 30+ turn sessions show **stable context growth** (no persistent accumulation of large tool outputs).
- “Rehydrate” of pruned info is reliable: the model can re-run targeted tools or open cached full outputs.

## 4. Non-goals
- Supporting non-TS/JS languages.
- Replacing pi’s built-in tools (`read/edit/write/bash`) entirely.
- Cloud indexing or sending repository code off-machine.
- Perfect semantic search; focus is workflow utility + bounded outputs.

## 5. Key product decisions
1. **Indexing requires confirmation** (first indexing can be slow / surprising).
2. **Auto task-context injection**: implement but ship as **opt-in**, with a recommended “smart” mode.
3. **Prune in LLM context AND truncate stored tool outputs**; preserve full data via a blob cache to avoid losing expandability/auditability.
4. **KotaDB runtime**: require **Bun** and spawn KotaDB via **`bun x kotadb@next --stdio --toolset core`** (avoids `bunx` shebang/PATH edge cases while staying aligned with KotaDB development).
5. **MCP schemas in context are a non-starter**: pi-kota exposes a small curated toolset; MCP SDK is used internally only.

## 6. User experience
### 6.1 Status
The extension maintains a small, always-visible status indicator:
- `kota: stopped|starting|running`
- `repo: <detected repo name or root>`
- `indexed: yes|no`

### 6.2 Commands
- `/kota status` — show process state, repo root, repository id (if known), last index stats, and config source.
- `/kota index` — confirm and index current repo.
- `/kota restart` — restart the KotaDB subprocess.
- `/kota pruning` — show pruning configuration + last pruning actions.
- `/kota pin` — pin the last “meaning-bearing” tool summary (prevents pruning).
- `/kota blobs` — show blob cache location and last N stored blobs (optional).

### 6.3 Tools (LLM-callable)
The extension exposes a **curated toolset** that maps to KotaDB “core” capabilities.

Tools are output-budgeted by default.

#### `kota_index`
- Ensures repo is indexed (with user confirmation if indexing is needed).
- Inputs: `{ path?: string }` (default: `ctx.cwd`)

#### `kota_search`
- Inputs: `{ query: string, scope?: string[], output?: 'paths'|'compact'|'snippet', limit?: number, context_lines?: number, filters?: {...} }`
- Defaults: `scope=['code']`, `output='compact'`, `limit=15`, `context_lines=1`
- Hard caps: `limit<=50`, `context_lines<=5`
- Behavior: automatically **downshifts** to `paths` (and/or lowers `limit/context_lines`) if the formatted output would exceed the tool output budget.

#### `kota_deps`
- Inputs: `{ file_path: string, direction?: 'dependents'|'dependencies'|'both', depth?: number, include_tests?: boolean }`
- Defaults: `direction='both'`, `depth=1`, `include_tests=false`
- Hard cap: `depth<=3` (wrapper cap even if KotaDB supports more)

#### `kota_usages`
- Inputs: `{ symbol: string, file?: string, include_tests?: boolean }`
- Defaults: `include_tests=false`

#### `kota_impact`
- Inputs: `{ change_type, description, files_to_modify?, files_to_create?, files_to_delete? }`
- Output must be **summary-first** (risk + affected surface + recommended tests).
- Output is pinned by default (configurable).

#### `kota_task_context`
- Inputs: `{ files: string[], include_tests?: boolean, include_symbols?: boolean, max_impacted_files?: number }`
- Defaults: `include_tests=true`, `include_symbols=false`, `max_impacted_files=20`

### 6.4 Output gating
- The extension will not return KotaDB “full dumps” by default.
- Any request that would exceed the configured budget should be handled by:
  1) downshifting the request (e.g., `snippet` → fewer context lines, lower limit)
  2) summarizing output
  3) storing full output to blob cache and returning a pointer + excerpt
  4) (interactive) optionally asking the user to confirm an expanded response

## 7. Auto task-context injection (opt-in)
### 7.1 Modes
Configuration option: `autoContext`:
- `off` (default in v1)
- `onPaths` (recommended): inject context only when user message contains **1–3 explicit file paths**
- `always` (power users)

### 7.2 Trigger rules for `onPaths`
- Parse user prompt for file-path-like tokens (e.g., `src/foo.ts`, `app/components/X.tsx`).
- If 1–3 unique paths are found:
  - if not indexed: ask to index
  - call `kota_task_context(files=[...])`
  - inject a **tiny briefing** as a custom message before the agent proceeds
- If >3 paths: do not auto-inject; suggest user explicitly call `kota_task_context`.

### 7.3 Injection format
Injected message should be small and structured, e.g.
- key dependencies (top 5)
- top impacted dependents (top 10)
- suggested tests (top 5)
- caveat: “rehydrate via kota_deps/kota_search(snippet) as needed”

## 8. Pruning policy (hybrid)
### 8.1 Principle
Be **aggressive on payload**, **conservative on meaning**.
- Keep current plan, constraints, and decision summaries.
- Remove old raw excerpts and large tool outputs.

### 8.2 Where pruning happens
Two layers:
1) **LLM-context pruning**: `pi.on('context', ...)` rewrites `event.messages` before each model call.
2) **Session-size control**: `pi.on('tool_result', ...)` truncates stored tool outputs and saves the full output to blob cache.

### 8.3 What gets pruned
Default settings:
- Keep last `keepRecentTurns=2` intact.
- For older turns, prune if:
  - tool is `read` or `bash`
  - tool is `kota_search` and output was `snippet`
  - tool output exceeds `maxToolChars` (default 1200)

### 8.4 Replacement format (rehydration pointer)
Replace pruned content with a placeholder containing:
- tool name
- key arguments
- explicit rehydration instructions

Example:
> (Pruned) kota_search(query="auth context", scope=["code"], output="snippet", limit=20). Re-run with narrower query/glob to rehydrate.

### 8.5 Pinning
- `/kota pin` pins the last meaning-bearing summary (or last tool result).
- `kota_impact` summary is pinned by default (configurable).

### 8.6 Adaptive pruning
If `ctx.getContextUsage()?.tokens` exceeds a threshold:
- reduce `keepRecentTurns` (2 → 1)
- reduce `maxToolChars` (1200 → 800)
- widen the set of prune-candidate tools

## 9. Blob cache (to preserve full outputs)
### 9.1 Purpose
When truncating tool outputs, we still want:
- user expandability
- debugging/audit trail
- deterministic rehydration (without relying solely on re-running tools after repo changes)

### 9.2 Storage
- Default path: `~/.pi/cache/pi-kota/blobs/`
- Blob filename: `<sha256>.txt` (or `.json` where applicable)
- Tool result `details` include:
  - `{ truncated: true, blobId, blobPath, originalBytes, excerptBytes }`

### 9.3 Retention
- Default max size: 250MB (configurable)
- Default max age: 14 days
- Cleanup: on session start and periodically (best-effort)

### 9.4 v1 scoping
- v1 applies blob-cache truncation **only to `kota_*` tool results**.
- Built-in tools (`read`, `bash`, etc.) are not blob-cached in v1.

## 10. Architecture
### 10.1 KotaDB subprocess
- Spawn (hard requirement): `bun x kotadb@next --stdio --toolset core`
- Ensure logs go to stderr; stdout reserved for JSON-RPC.
- Restart on crash with exponential backoff.
- Start lazily on first `kota_*` call or `/kota status`.

### 10.2 MCP client (use the SDK; no schema bloat)
- Use `@modelcontextprotocol/sdk`:
  - `StdioClientTransport` to spawn and connect over stdio.
  - `Client` to handle MCP initialization and `callTool`.
- Important: MCP tool schemas are never registered as pi tools; only `kota_*` tools exist in the pi tool list.

### 10.3 pi events used
- `session_start`: detect repo root; optionally show status widget.
- `session_shutdown`: terminate subprocess.
- `before_agent_start`: optionally run autoContext injection.
- `context`: prune messages sent to the LLM.
- `tool_result`: truncate and blob-cache large results (v1: `kota_*` only).

## 11. Configuration
Initial config (global defaults, overridable per project):

### 11.1 Locations
- Global: `~/.pi/agent/pi-kota.json`
- Project override: `.pi/pi-kota.json`

### 11.2 Shape
```json
{
  "kota": {
    "toolset": "core",
    "autoContext": "off",
    "confirmIndex": true,
    "command": "bun",
    "args": ["x", "kotadb@next", "--stdio", "--toolset", "core"]
  },
  "prune": {
    "enabled": true,
    "keepRecentTurns": 2,
    "maxToolChars": 1200,
    "adaptive": true,
    "pinImpactSummaries": true
  },
  "blobs": {
    "enabled": true,
    "dir": "~/.pi/cache/pi-kota/blobs",
    "maxBytes": 262144000,
    "maxAgeDays": 14
  }
}
```

## 12. Security & privacy
- All indexing and queries are local.
- Blob cache may contain source excerpts; treat it as sensitive.
- Provide a command to purge blob cache: `/kota purge-blobs` (optional).

## 13. Rollout plan
### Phase 1 (MVP)
- Subprocess manager + MCP SDK client
- Tools: index/search/deps/usages/impact/task_context
- Index confirmation flow

### Phase 2 (Anti-bloat)
- LLM-context pruning (`context` event)
- Tool result truncation + blob cache (v1: `kota_*` only)
- Pinning

### Phase 3 (Quality of life)
- AutoContext `onPaths` mode + injection UI
- Better renderers for compact results
- Diagnostics UI (`/kota pruning` details)

## 14. Risks / trade-offs
- `bun x kotadb@next` implies network + moving target; simple but can break unexpectedly.
- Truncating tool results reduces “expand in TUI” unless blob cache pointers are implemented correctly.
- Re-running tools for rehydration can drift as repo changes; blob cache mitigates.
- AutoContext can become spammy; ship opt-in and strict triggers.

## 15. Acceptance scenarios
1) **Refactor planning**: user asks “what breaks if I change X.ts?”
   - tool calls remain compact
   - impact summary pinned
   - no large file dumps persist

2) **Long session**: 30+ turns exploring dependencies/usages/impact
   - context usage remains stable due to pruning

3) **Rehydration**: after pruning, model can request a narrow snippet or user can open blob output

---

## Decisions captured
- Indexing requires confirmation: **yes**
- AutoContext: **implement**, default **off**, recommended **onPaths**
- MCP client: **use `@modelcontextprotocol/sdk` internally**, do not inject MCP tool schemas into context
- `kota_search` default output: **compact**, auto-downshift to paths when needed
- Pruning: **both** (LLM context + stored `kota_*` outputs) with **blob cache**
- Runtime: **Bun required**, spawn via **`bun x kotadb@next`**
- Config: global + project override at `~/.pi/agent/pi-kota.json` and `.pi/pi-kota.json`

## Attribution
pi-kota is built on top of [KotaDB](https://github.com/nicobailon/kotadb), created by **Nico Bailon**.
