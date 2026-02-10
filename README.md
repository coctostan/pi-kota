# pi-kota

KotaDB thin wrapper + context pruning for **pi** (TypeScript/JavaScript repos).

## Executive summary

### What it is
`pi-kota` is a **pi extension** that integrates **KotaDB** (local TS/JS code intelligence: search, dependency graph, symbol usages, impact analysis) into pi as a **small, output-budgeted toolset**, and adds **context pruning** so long-running sessions don’t bloat the model’s prompt with historical tool output.

- **KotaDB = brain** (persistent index/graph outside the LLM context)
- **pi extension = governor** (retrieval discipline + context hygiene + rehydration)

### Why it’s worth doing
Large TS/JS repo sessions degrade mainly because:
1) answering dependency/usage/impact questions pulls large snippets/files into the conversation
2) those outputs persist across turns, causing linear context growth and frequent compactions

`pi-kota` changes the economics:
- most questions become **small structured queries** (paths/counts/snippets) instead of full file reads
- older heavy outputs get **pruned from the LLM context** while staying recoverable

### Key decisions
- Indexing requires **user confirmation**.
- Auto task-context injection is **opt-in** (recommended mode: `onPaths` for 1–3 explicit file paths).
- Pruning happens both:
  - in the **LLM context** (`context` event), and
  - in **stored tool outputs** (`tool_result` event), with a **blob cache** to preserve full results.

## Docs
- Design doc: `docs/design.md`

## (Planned) installation

### Project-local
Copy/point the extension into your repo:
- `.pi/extensions/pi-kota/index.ts` (or a single `.ts` file)

### Global
Place it in:
- `~/.pi/agent/extensions/`

## Development status
This repository currently contains the design/spec. Implementation will add:
- a KotaDB subprocess manager (`bunx kotadb@next --stdio`)
- a minimal MCP stdio client
- pi tool wrappers (`kota_search`, `kota_deps`, etc.)
- pruning + blob cache
