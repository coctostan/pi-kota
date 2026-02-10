# Phase 1 — Automated End-to-End Smoke Test Design

> Automates the Phase 1 checklist from `docs/roadmap.md`.

---

## Overview

Two layers of testing:

1. **Integration test** (`smoke-e2e.test.ts`) — Mock `ExtensionAPI` + real KotaDB subprocess. Exercises every tool, command, event handler, pruning, and blob cache.
2. **Scripted pi session** (`smoke-live.test.ts`) — Real `pi` process driven via `interactive_shell`. Proves the full stack works end-to-end with no mocks.

Both use this repo (`pi-kota`) as the target codebase — known files provide deterministic assertions.

---

## File Layout

```
tests/
├── smoke-e2e.test.ts      # Integration test (mock API + real KotaDB)
├── smoke-live.test.ts      # Scripted pi session (real pi + interactive_shell)
└── helpers/
    └── mock-api.ts         # Shared mock ExtensionAPI factory
vitest.config.e2e.ts        # Separate vitest config for e2e tests only
```

**package.json scripts:**
- `"test:e2e": "vitest run -c vitest.config.e2e.ts"` — runs both smoke files
- `"test"` unchanged (fast unit tests only)

---

## Mock ExtensionAPI (`helpers/mock-api.ts`)

Captures all registrations so tests can invoke handlers/tools directly:

```ts
interface MockAPI {
  handlers: Map<string, Function>;
  tools: Map<string, { name: string; execute: Function; [k: string]: unknown }>;
  commands: Map<string, { handler: Function; [k: string]: unknown }>;

  on(event: string, handler: Function): void;
  registerTool(def: object): void;
  registerCommand(name: string, def: object): void;
  exec(cmd: string, args: string[], opts: object): Promise<{ code: number; stdout: string; stderr: string }>;
}
```

- `on()` → `handlers.set(event, handler)`
- `registerTool(def)` → `tools.set(def.name, def)`
- `registerCommand(name, def)` → `commands.set(name, def)`
- `exec(cmd, args, opts)` → actually shells out via `child_process.execFile`

**Fake context object** (passed to every handler/tool call):

```ts
{
  cwd: process.cwd(),
  hasUI: true,
  ui: {
    setStatus: vi.fn(),
    notify: vi.fn(),
    confirm: vi.fn(() => Promise.resolve(true)),  // auto-accept indexing
  },
  getContextUsage: () => ({ tokens: 5000 }),
}
```

---

## Integration Test (`smoke-e2e.test.ts`)

### Setup / Teardown

- **beforeAll:**
  - Check `bunx` available → skip suite if missing
  - Write `.pi/pi-kota.json` with `{ "prune": { "maxToolChars": 50 } }` for blob testing
  - Call extension default export with mock API
  - Fire `session_start` handler (triggers config load + repo detection)

- **afterAll:**
  - Fire `session_shutdown` handler
  - Remove temp `.pi/pi-kota.json`
  - Clean up blob files written during tests

### Test Cases (sequential, shared state)

| # | Test | Assertion |
|---|------|-----------|
| 1 | bun available | `which bunx` exits 0 (or skip suite) |
| 2 | session_start sets status | `ui.setStatus` called with `kota: stopped` |
| 3 | `/kota status` | `ui.notify` called with connection state, repo root, config sources |
| 4 | `/kota index` | `ui.confirm` called (confirmation dialog), `ui.notify` called with success |
| 5 | `kota_search` | `execute({ query: "loadConfig" })` → result text mentions `config.ts`, length ≤ 5000 |
| 6 | `kota_deps` | `execute({ file_path: "src/index.ts" })` → mentions known deps (`config.ts`, `runtime.ts`) |
| 7 | `kota_usages` | `execute({ symbol: "loadConfig" })` → mentions `index.ts` |
| 8 | `kota_impact` | `execute({ change_type: "refactor", description: "test" })` → `details.pinned === true` |
| 9 | context pruning | Build 12+ tool-result messages, fire `context` handler → older turns pruned with rehydration pointers |
| 10 | blob cache | Fire `tool_result` handler with large payload + `maxToolChars: 50` → blob file created, truncated text includes blob ID |
| 11 | `/kota restart` + reconnect | Fire restart command, then call `kota_search` again → reconnects, returns results |

---

## Scripted Pi Session (`smoke-live.test.ts`)

### Prerequisites

- `pi` on PATH (skip if missing)
- `bun`/`bunx` on PATH (skip if missing)

### How It Works

Launches `pi -e ./src/index.ts --no-extensions` via `interactive_shell` in hands-free mode. Drives the session by sending input and reading output.

### Test Flow

| Step | Input | Assert output contains |
|------|-------|----------------------|
| 1 | `/kota status` | `kota: stopped` |
| 2 | `"Run kota_index to index this repository"` | Index completion |
| 3 | `"Use kota_search to find the loadConfig function"` | `config.ts` |
| 4 | `"Use kota_deps to find dependencies of src/index.ts"` | Known dependency names |
| 5 | `"Use kota_impact for a refactor change"` | No crash, output present |
| 6 | `/kota restart` | "reset" or "reconnect" |
| 7 | `"Use kota_search to find extractFilePaths"` | Works after restart |
| 8 | Kill session | — |

### Differences from Integration Test

- Full pi ↔ extension ↔ KotaDB stack (zero mocks)
- Validates tool registration, event wiring, LLM tool-calling
- Does NOT test pruning or blobs (internal machinery, covered by integration test)
- Slower, slightly nondeterministic (LLM chooses how to call tools)

### Timeouts

- 60s per prompt step
- 5 minute overall suite timeout

---

## Skip Logic

- `smoke-e2e.test.ts`: `beforeAll` checks `which bunx`, skips if missing
- `smoke-live.test.ts`: `beforeAll` checks `which pi` and `which bunx`, skips if missing

---

## Cleanup

- Temp `.pi/pi-kota.json` → created in beforeAll, removed in afterAll
- Blob cache files → cleaned up in afterAll
- KotaDB process → killed via `session_shutdown`
- Pi session → killed via `interactive_shell({ kill: true })`
