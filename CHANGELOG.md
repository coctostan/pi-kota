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
