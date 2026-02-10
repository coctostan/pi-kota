# Bun PATH Resilience — Design

> Make pi-kota's bun dependency discoverable at install time and diagnosable at runtime.

**Problem:** pi-kota spawns KotaDB via `bunx kotadb@next --stdio`. KotaDB's entry script has a `#!/usr/bin/env bun` shebang. If `bun` isn't on PATH — even when `bunx` is (common with partial installs, symlink-only setups, non-login shells) — the subprocess dies immediately. The user sees `MCP error -32000: Connection closed` with no indication it's a PATH issue.

**Root cause:** `bunx` can exist as a standalone symlink (e.g., `~/.local/bin/bunx → ~/.bun/bin/bun`) while `~/.bun/bin` itself isn't on PATH. The child process spawned by `bunx` needs `bun` on PATH for the shebang to resolve.

---

## Change 1: Default Command — `bunx` → `bun x`

KotaDB is a bun-native project. Its docs use `bun` everywhere. `bun x` is functionally identical to `bunx` (it's the subcommand equivalent). Switching eliminates the split-binary problem entirely.

**`src/config.ts` — default config:**
```ts
// Before
command: "bunx",
args: ["kotadb@next", "--stdio", "--toolset", "core"],

// After
command: "bun",
args: ["x", "kotadb@next", "--stdio", "--toolset", "core"],
```

Non-breaking for existing users — anyone with `bunx` working also has `bun`. Users who override `kota.command` in `pi-kota.json` keep their custom config.

---

## Change 2: Postinstall Check Script

A plain Node.js script at `scripts/check-bun.js` that runs via `"postinstall": "node scripts/check-bun.js"` in `package.json`. No dependencies — just `child_process.execFileSync` and `fs.realpathSync`.

**Logic:**

1. Try `bun --version` — if it succeeds, exit silently (code 0)
2. If it fails, gather diagnostics:
   - Check if `bunx` exists (follow symlinks to find where bun actually lives)
   - Capture `process.env.PATH` for display
3. Print a warning and exit 0 (non-blocking — install proceeds)

**Warning variant 1 — `bun` not found, `bunx` found (PATH issue):**
```
  ⚠  pi-kota: 'bun' is not on PATH

  Found bunx at: /home/pi/.local/bin/bunx
  Which resolves to: /home/pi/.bun/bin/bun

  Add bun's directory to your PATH:
    export PATH="$HOME/.bun/bin:$PATH"

  Or symlink it:
    ln -s /home/pi/.bun/bin/bun /home/pi/.local/bin/bun

  Current PATH:
    /home/pi/.local/bin:/usr/local/bin:/usr/bin:/bin
```

**Warning variant 2 — neither `bun` nor `bunx` found (not installed):**
```
  ⚠  pi-kota: bun runtime not found

  pi-kota requires bun to run KotaDB. Install it:
    curl -fsSL https://bun.sh/install | bash

  Then restart your terminal or run:
    source ~/.bashrc
```

The script resolves symlinks via `fs.realpathSync` to find bun's actual bin directory — that's how it produces a specific `export PATH=` suggestion rather than a generic one.

---

## Change 3: Runtime Error Improvement

The postinstall check is the first line of defense, but users might install pi-kota before bun, or break their PATH later. When `ensureConnected` fails at runtime, the current error is `MCP error -32000: Connection closed` — useless.

**The fix lives in `KotaMcpClient.connect()` in `src/kota/mcp.ts`.** Capture stderr from the subprocess and classify the failure:

- If stderr contains `No such file or directory` or spawn errors with `ENOENT` → throw: `"pi-kota: 'bun' not found on PATH. Install bun (https://bun.sh) or check your PATH."`
- If the process exits immediately (non-zero) with stderr → include stderr: `"pi-kota: KotaDB subprocess failed — <stderr snippet>"`
- If connection times out → `"pi-kota: KotaDB failed to start within 10s. Run '/kota status' for diagnostics."`

Lightweight — no pre-flight checks burning context, just better catch-and-rethrow around the existing `client.connect()` call. Stderr is already piped (`stderr: "pipe"` in the current code), we just need to read it on failure.

Status bar updates automatically — `ensureConnected` already sets `state.lastError` and calls `ctx.ui.setStatus`. The only change is the error message is now actionable.

---

## Change 4: Testing Strategy

**Unit test for postinstall script (`tests/check-bun.test.ts`):**
- Run `node scripts/check-bun.js` with modified PATH excluding bun → assert warning appears, exit code 0
- Run with bun on PATH → assert no output

**Unit test for MCP errors (`tests/kota-mcp.test.ts`):**
- Spawn nonexistent binary → assert error contains "not found on PATH"
- Spawn command that exits with stderr → assert stderr surfaces in error

**Config default (`tests/config.test.ts`):**
- Update assertion to expect `command: "bun"`, `args: ["x", "kotadb@next", ...]`

**E2E suite (`tests/smoke-e2e.test.ts`):**
- No changes. Existing test validates the full `bun x kotadb@next` → MCP → tool call path.

---

## File Changes

**New files:**
- `scripts/check-bun.js` — postinstall validation (~40 lines)
- `tests/check-bun.test.ts` — postinstall script tests

**Modified files:**
- `package.json` — add `"postinstall": "node scripts/check-bun.js"`
- `src/config.ts` — default command `"bunx"` → `"bun"`, args prepend `"x"`
- `src/kota/mcp.ts` — error classification in `connect()`
- `README.md` — update default config block
- `tests/kota-mcp.test.ts` — add error classification cases
- `tests/config.test.ts` — update default config assertion

**Not changed:**
- `src/index.ts` — delegates to `ensureConnected` which uses config
- `tests/smoke-e2e.test.ts` — existing test covers the full path
