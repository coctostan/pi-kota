# Phase 2+3: Hardening, Error Recovery & Test Coverage

**Date:** 2026-02-10
**Scope:** Roadmap Phase 2 (Hardening & Error Recovery) + Phase 3 (Test Coverage Expansion), combined.
**Deferred:** Index staleness detection (Phase 2 item) — deferred to later phase.

## 1. MCP Reconnection & Partial Failure Isolation

**Problem:** If KotaDB crashes mid-session, `state.mcp.isConnected()` still returns true, and the next `callTool` throws an unrecoverable error.

**Design:**

- In `KotaMcpClient`, add a `disconnect()` method that nulls the internal client without sending a clean shutdown message.
- In `callBudgeted`, wrap the `callTool` invocation to catch connection-level errors (broken pipe, transport closed). On such errors, call `disconnect()` so `isConnected()` returns false, then re-throw.
- In `ensureConnected()`, since the broken client is now nulled out, the next tool call naturally reconnects. No retry loop needed.
- Partial failure: a single failed MCP call already doesn't "poison" the connection because `callBudgeted` catches and returns `{ ok: false }`. The gap is only when the transport itself dies — reconnect-on-broken handles this.

Reconnection is lazy (only on next tool call) with no background health checks or retry loops.

## 2. Startup Timeout

**Problem:** `client.connect()` has no timeout — if KotaDB hangs during startup, the tool call blocks indefinitely.

**Design:**

- Add `connectTimeout` config option to `PiKotaConfig.kota` (default: 10000ms).
- In `KotaMcpClient.connect()`, wrap the MCP client connect call with `Promise.race` against a timeout. On timeout, kill the spawned process and throw: `"KotaDB failed to start within 10s. Check that 'bun' is installed and working. Run /kota restart to retry."`
- No automatic retry — the error surfaces to the agent, which can try again or the user can run `/kota restart`.

## 3. Graceful Shutdown

**Problem:** No cleanup when the pi session ends — spawned KotaDB process becomes orphaned.

**Design:**

- In the extension's `init` function, register a cleanup handler (via pi's `context.onDispose()` or `process.on('exit')`). This calls `client.close()`.
- Make `close()` idempotent — safe to call multiple times. Send `SIGTERM` with 2s grace period, then `SIGKILL` if process still alive.
- Set `detached: false` on spawned child process (belt-and-suspenders).

## 4. Test Coverage Expansion

### New tests for Phase 2 features

**`kota-mcp.test.ts` additions:**
- Connection timeout: mock a never-resolving connect, verify timeout fires and error message is correct.
- Reconnect after disconnect: simulate broken transport, verify next call reconnects.
- `close()` idempotency: call twice, verify no throw.

### Existing gap coverage (Phase 3)

**`kota-tools.test.ts`:**
- `callBudgeted` edge cases: MCP returns error shape, MCP throws (transport-level), budget exceeded mid-call.

**`prune.test.ts`:**
- Pruning with zero-length messages, messages with no tool results, messages already under budget.

**`config.test.ts`:**
- Missing config file (defaults used), partial config (some keys present, others default), invalid types in config.

**`blobs.test.ts`:**
- Concurrent writes to same blob ID (idempotent by hash), very large content, special characters.

**`autocontext.test.ts`:**
- No repo root detected, no matching files in prompt.

All unit tests — no KotaDB process needed. Existing mock patterns provide clean injection points.

## 5. Out of Scope

- No index staleness detection (deferred)
- No background health checks or heartbeats
- No automatic retry loops
- No new CLI commands
- No config schema migration — `connectTimeout` is optional with a default
