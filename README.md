![pi-kota banner](docs/assets/banners/21x6/banner-01-21x6.png)

# pi-kota

KotaDB thin wrapper + context pruning extension for **pi** (TypeScript/JavaScript repos).

## What it provides

- Bounded-output `kota_*` tools backed by KotaDB over MCP stdio
- Session context pruning to keep long runs lean
- Tool-result truncation with blob caching for recoverability

## Prerequisites

`pi-kota` requires Bun tooling to launch KotaDB:

- `bun`
- `bunx`

Quick check:

```bash
bun --version
bunx --version
```

## Install the extension

You can place the extension either project-local or global.

### Project-local

Put the extension at:

- `.pi/extensions/pi-kota/index.ts`

or point pi to this repo file directly:

- `/home/pi/pi-kota/src/index.ts`

### Global

Put it under:

- `~/.pi/agent/extensions/`

## Commands

- `/kota status`
- `/kota index`
- `/kota restart`
- `/kota reload-config`

## Tools

- `kota_index`
- `kota_search`
- `kota_deps`
- `kota_usages`
- `kota_impact`
- `kota_task_context`

## Config files

- Global override: `~/.pi/agent/pi-kota.json`
- Project override: `.pi/pi-kota.json`

## Development

```bash
npm install
npm test
npm run typecheck
```

## Design reference

- `docs/design.md`
