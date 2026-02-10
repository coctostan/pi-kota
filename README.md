![pi-kota banner](docs/assets/banners/21x6/banner-01-21x6.png)

# pi-kota

> **Code intelligence that doesn't eat your context window.**

A [pi](https://github.com/mariozechner/pi-mono) extension that gives your coding agent a persistent, dependency-aware brain for TypeScript and JavaScript repos — powered by [KotaDB](https://github.com/nicobailon/kotadb) over MCP, with built-in context pruning to keep long sessions sharp.

---

## ✨ What It Does

| Problem | pi-kota's Answer |
|---------|-----------------|
| Agent repeatedly reads large files to answer "what depends on X?" | `kota_deps` — instant dependency graph from a persistent index |
| 30-turn sessions bloat with stale tool output | Context pruning removes old payloads, preserves meaning + rehydration paths |
| Impact analysis requires the agent to trace imports manually | `kota_impact` — change impact summary, pinned so it survives pruning |
| Large tool results blow up the context budget | Automatic truncation + blob cache — full output recoverable on demand |

### The Short Version

```
KotaDB = persistent code index (deps, symbols, usages, impact)
pi-kota = thin wrapper + context governor (bounded output, pruning, blob cache)
```

You get fast, bounded queries over your codebase without raw file dumps accumulating in the conversation.

---

## 🔧 Tools

Six curated tools, all output-bounded by default:

| Tool | What It Does |
|------|-------------|
| `kota_index` | Index the current repository (with confirmation prompt) |
| `kota_search` | Code search — `paths`, `compact`, or `snippet` output modes |
| `kota_deps` | Dependency graph queries (dependents, dependencies, or both) |
| `kota_usages` | Find all usages of a symbol across the repo |
| `kota_impact` | Analyze change impact — risk surface, affected files, recommended tests |
| `kota_task_context` | Summarize deps + impact for a set of files (great for task planning) |

## ⌨️ Commands

| Command | Description |
|---------|-------------|
| `/kota status` | Show process state, repo root, index status, config sources |
| `/kota index` | Trigger indexing (with confirmation) |
| `/kota restart` | Reset KotaDB connection (next tool call reconnects) |
| `/kota reload-config` | Reload config from disk |

---

## 🧹 Context Governance

pi-kota prevents context bloat through two layers:

**1. LLM Context Pruning** (`context` event)
- Keeps the last N turns intact (default: 2)
- Older `read`, `bash`, and `kota_search` results get replaced with compact rehydration pointers
- Adaptive mode tightens pruning when token usage climbs

**2. Tool Result Truncation** (`tool_result` event)
- Large `kota_*` outputs are truncated to `maxToolChars`
- Full output saved to blob cache (`~/.pi/cache/pi-kota/blobs/`)
- Blob ID included in the truncated result for recovery

---

## 📦 Prerequisites

pi-kota spawns KotaDB via Bun:

```bash
bun --version    # required
```

`npm install` runs a non-blocking Bun availability check (`scripts/check-bun.js`) and prints PATH guidance if Bun is missing.

### Bun PATH troubleshooting

If startup fails with:

`pi-kota: 'bun' not found on PATH`

Install Bun and ensure your shell PATH includes Bun's bin directory (usually `~/.bun/bin`).

---

## 🚀 Install

### As a pi package

Add to `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):

```json
{
  "packages": ["git:github.com/coctostan/pi-kota"]
}
```

### Manual (project-local)

Point pi at the extension entry point in `.pi/settings.json`:

```json
{
  "extensions": ["./path/to/pi-kota/src/index.ts"]
}
```

### Manual (global)

Symlink or copy the extension to `~/.pi/agent/extensions/`.

---

## ⚙️ Configuration

Config files are layered — global defaults, then project overrides:

| Scope | Path |
|-------|------|
| Global | `~/.pi/agent/pi-kota.json` |
| Project | `.pi/pi-kota.json` |

### Default Config

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
    "adaptive": true
  },
  "blobs": {
    "enabled": true,
    "dir": "~/.pi/cache/pi-kota/blobs"
  }
}
```

### Key Options

| Option | Default | Description |
|--------|---------|-------------|
| `kota.autoContext` | `"off"` | Auto-inject task context: `"off"`, `"onPaths"` (1–3 file paths in prompt), `"always"` |
| `kota.confirmIndex` | `true` | Prompt before first indexing |
| `prune.keepRecentTurns` | `2` | Turns to keep intact before pruning |
| `prune.maxToolChars` | `1200` | Max chars per tool result before truncation |
| `prune.adaptive` | `true` | Tighten pruning when context usage is high |
| `blobs.enabled` | `true` | Save full truncated outputs to blob cache |

---

## 🛠️ Development

```bash
npm install
npm test
npm run test:e2e
npm run typecheck
```

### Architecture

```
src/
├── index.ts          # Extension entry — events, commands, tool registration
├── runtime.ts        # Runtime state + path normalization
├── config.ts         # Layered config loading (global + project)
├── prune.ts          # Context pruning logic + adaptive settings
├── autocontext.ts    # Auto task-context injection rules
├── blobs.ts          # Blob cache writes
├── paths.ts          # File path extraction from prompts
├── text.ts           # Text truncation utilities
├── toolResult.ts     # Tool result truncation decisions
└── kota/
    ├── mcp.ts        # MCP stdio client (KotaDB connection)
    ├── tools.ts      # Budgeted tool calls + name mapping
    ├── schemas.ts    # TypeBox schemas for kota_* tool params
    └── ensure.ts     # Index confirmation flow
```

### Design Reference

See [`docs/design.md`](docs/design.md) for the full design spec.

---

## 🙏 Attribution

pi-kota is built on top of [KotaDB](https://github.com/nicobailon/kotadb), created by **Nico Bailon**. Big thanks to Nico for designing and maintaining the code intelligence engine that powers this extension.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
