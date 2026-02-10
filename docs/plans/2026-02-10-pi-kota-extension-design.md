# pi-kota Extension Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.
>
> **Historical note (current behavior differs):** This plan was authored before Bun PATH hardening. Current runtime defaults are `command: "bun"` with args beginning `"x"` (not `bunx`). See `README.md` and `src/config.ts` for current source of truth.

**Goal:** Implement `pi-kota` as a pi extension that (1) exposes a small, bounded-output `kota_*` toolset backed by a KotaDB MCP server over stdio, and (2) prevents long-session bloat via context pruning and `kota_*` tool-result truncation + blob caching.

**Architecture:** The extension entrypoint (`src/index.ts`) holds only wiring and small orchestration. All behavior (config, path extraction, truncation, pruning, blob cache, MCP client, indexing confirmation) lives in small pure modules under `src/`, unit-tested with Vitest. KotaDB is started lazily via MCP’s `StdioClientTransport` (spawns `bunx kotadb@next --stdio --toolset core`).

**Tech Stack:** TypeScript (ESM), pi extension API (`@mariozechner/pi-coding-agent`), TypeBox (`@sinclair/typebox`), MCP SDK (`@modelcontextprotocol/sdk`), Vitest.

---

## Prerequisites / reference docs

- Product spec (keep as source of truth): `docs/design.md`
- pi extension API reference: `/home/pi/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`

---

### Task 1: Add dev tooling + required dependencies

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

**Step 1: Write the failing test**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Missing script: "test"`.

**Step 3: Write minimal implementation**

Modify `package.json` (replace entire file):

```json
{
  "name": "pi-kota",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "description": "KotaDB thin wrapper + context pruning extension for pi",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "^0.52.9",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

Install:

Run: `npm install`

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts tests/smoke.test.ts
git commit -m "chore: add deps + test tooling"
```

---

### Task 2: Add config defaults + loader (global + project override)

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Step 1: Write the failing test**

Create `tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config.js";

describe("config", () => {
  it("deep merges overrides into defaults", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      prune: { maxToolChars: 999 },
      blobs: { enabled: false },
    });

    expect(merged.prune.maxToolChars).toBe(999);
    expect(merged.blobs.enabled).toBe(false);

    // unchanged defaults still present
    expect(merged.prune.keepRecentTurns).toBe(DEFAULT_CONFIG.prune.keepRecentTurns);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/config.js'`.

**Step 3: Write minimal implementation**

Create `src/config.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type AutoContextMode = "off" | "onPaths" | "always";

export interface PiKotaConfig {
  kota: {
    toolset: "core";
    autoContext: AutoContextMode;
    confirmIndex: boolean;
    command: string;
    args: string[];
  };
  prune: {
    enabled: boolean;
    keepRecentTurns: number;
    maxToolChars: number;
    adaptive: boolean;
  };
  blobs: {
    enabled: boolean;
    dir: string;
  };
}

export const DEFAULT_CONFIG: PiKotaConfig = {
  kota: {
    toolset: "core",
    autoContext: "off",
    confirmIndex: true,
    command: "bunx",
    args: ["kotadb@next", "--stdio", "--toolset", "core"],
  },
  prune: {
    enabled: true,
    keepRecentTurns: 2,
    maxToolChars: 1200,
    adaptive: true,
  },
  blobs: {
    enabled: true,
    dir: "~/.pi/cache/pi-kota/blobs",
  },
};

export function expandTilde(p: string, homeDir: string): string {
  if (p === "~") return homeDir;
  if (p.startsWith("~/")) return path.join(homeDir, p.slice(2));
  return p;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function mergeConfig(base: PiKotaConfig, override: Partial<PiKotaConfig>): PiKotaConfig {
  const out: any = structuredClone(base);

  const merge = (target: any, src: any) => {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v === undefined) continue;
      if (isObject(v) && isObject(target[k])) merge(target[k], v);
      else target[k] = v;
    }
  };

  merge(out, override);
  return out as PiKotaConfig;
}

async function readJsonIfExists(filePath: string): Promise<any | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e: any) {
    if (e?.code === "ENOENT") return undefined;
    throw e;
  }
}

export async function loadConfig(opts?: {
  cwd?: string;
  homeDir?: string;
}): Promise<{ config: PiKotaConfig; sources: { global?: string; project?: string } }> {
  const cwd = opts?.cwd ?? process.cwd();
  const homeDir = opts?.homeDir ?? os.homedir();

  const globalPath = path.join(homeDir, ".pi/agent/pi-kota.json");
  const projectPath = path.join(cwd, ".pi/pi-kota.json");

  const globalJson = await readJsonIfExists(globalPath);
  const projectJson = await readJsonIfExists(projectPath);

  let config = DEFAULT_CONFIG;
  const sources: { global?: string; project?: string } = {};

  if (globalJson) {
    config = mergeConfig(config, globalJson);
    sources.global = globalPath;
  }
  if (projectJson) {
    config = mergeConfig(config, projectJson);
    sources.project = projectPath;
  }

  config = {
    ...config,
    blobs: {
      ...config.blobs,
      dir: expandTilde(config.blobs.dir, homeDir),
    },
  };

  return { config, sources };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config defaults + loader"
```

---

### Task 3: Implement repo-relative file-path extraction (for autoContext)

**Files:**
- Create: `src/paths.ts`
- Create: `tests/paths.test.ts`

**Step 1: Write the failing test**

Create `tests/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractFilePaths } from "../src/paths.js";

describe("extractFilePaths", () => {
  it("extracts repo-like paths, deduped in order", () => {
    const text = "Touch src/index.ts, docs/design.md, and src/index.ts";
    expect(extractFilePaths(text)).toEqual(["src/index.ts", "docs/design.md"]);
  });

  it("ignores absolute paths and urls", () => {
    const text = "See https://example.com and /etc/passwd";
    expect(extractFilePaths(text)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/paths.js'`.

**Step 3: Write minimal implementation**

Create `src/paths.ts`:

```ts
const PATH_TOKEN_RE = /\b([A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-\.]+)+)\b/g;

function isRepoRelativePath(token: string): boolean {
  if (token.startsWith("/")) return false;
  if (token.startsWith("http://") || token.startsWith("https://")) return false;
  if (token.includes(":\\")) return false; // windows absolute
  if (token.includes("..")) return false;

  const last = token.split("/").at(-1) ?? "";
  if (!last.includes(".")) return false;
  return true;
}

export function extractFilePaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    const token = m[1];
    if (!token) continue;
    if (!isRepoRelativePath(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }

  return out;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat: add file path extraction"
```

---

### Task 4: Add truncation helpers (bounded outputs)

**Files:**
- Create: `src/text.ts`
- Create: `tests/text.test.ts`

**Step 1: Write the failing test**

Create `tests/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { truncateChars } from "../src/text.js";

describe("truncateChars", () => {
  it("truncates and adds ellipsis", () => {
    expect(truncateChars("abcdef", 4)).toBe("abc…");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/text.js'`.

**Step 3: Write minimal implementation**

Create `src/text.ts`:

```ts
export function truncateChars(input: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (input.length <= maxChars) return input;
  if (maxChars === 1) return "…";
  return input.slice(0, maxChars - 1) + "…";
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/text.ts tests/text.test.ts
git commit -m "feat: add truncateChars"
```

---

### Task 5: Implement blob cache writer (for truncated tool results)

**Files:**
- Create: `src/blobs.ts`
- Create: `tests/blobs.test.ts`

**Step 1: Write the failing test**

Create `tests/blobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeBlob } from "../src/blobs.js";

describe("writeBlob", () => {
  it("writes <sha256>.txt", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-"));
    const res = await writeBlob({ dir, content: "hello" });
    expect(res.blobId).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(res.blobPath, "utf8")).toBe("hello");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/blobs.js'`.

**Step 3: Write minimal implementation**

Create `src/blobs.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export async function writeBlob(opts: {
  dir: string;
  content: string;
  ext?: ".txt" | ".json";
}): Promise<{ blobId: string; blobPath: string; bytes: number }> {
  const ext = opts.ext ?? ".txt";
  const blobId = createHash("sha256").update(opts.content, "utf8").digest("hex");
  const blobPath = path.join(opts.dir, `${blobId}${ext}`);

  await mkdir(opts.dir, { recursive: true });
  await writeFile(blobPath, opts.content, "utf8");

  return { blobId, blobPath, bytes: Buffer.byteLength(opts.content, "utf8") };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/blobs.ts tests/blobs.test.ts
git commit -m "feat: add blob writer"
```

---

### Task 6: Implement pruning helpers (context event)

**Files:**
- Create: `src/prune.ts`
- Create: `tests/prune.test.ts`

**Step 1: Write the failing test**

Create `tests/prune.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pruneContextMessages } from "../src/prune.js";

const user = (t: string) => ({ role: "user", content: [{ type: "text", text: t }], timestamp: 1 });
const tool = (name: string, text: string) => ({
  role: "toolResult",
  toolName: name,
  content: [{ type: "text", text }],
  details: {},
  timestamp: 1,
});

describe("pruneContextMessages", () => {
  it("replaces large old tool results with a placeholder", () => {
    const messages = [
      user("A"),
      tool("read", "x".repeat(5000)),
      user("B"),
    ];

    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });

    expect((pruned[1] as any).content[0].text).toContain("(Pruned)");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/prune.js'`.

**Step 3: Write minimal implementation**

Create `src/prune.ts`:

```ts
function isToolResult(m: any): m is { role: "toolResult"; toolName: string; content: any[]; details?: any } {
  return m && typeof m === "object" && m.role === "toolResult" && typeof m.toolName === "string";
}

function toolText(m: any): string {
  const block = Array.isArray(m?.content) ? m.content.find((b: any) => b?.type === "text") : undefined;
  return typeof block?.text === "string" ? block.text : "";
}

export function computePruneSettings(
  base: { keepRecentTurns: number; maxToolChars: number },
  tokens: number | undefined,
): { keepRecentTurns: number; maxToolChars: number } {
  if (!tokens) return base;
  if (tokens < 120_000) return base;
  return {
    keepRecentTurns: Math.max(1, base.keepRecentTurns - 1),
    maxToolChars: Math.max(400, Math.floor(base.maxToolChars * 0.66)),
  };
}

export function pruneContextMessages(
  messages: any[],
  opts: {
    keepRecentTurns: number;
    maxToolChars: number;
    pruneToolNames: Set<string>;
  },
): any[] {
  const keepRecentTurns = Math.max(0, opts.keepRecentTurns);
  if (keepRecentTurns === 0) return messages;

  const userIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") userIndexes.push(i);
  }

  const cutoff = userIndexes.length > keepRecentTurns ? userIndexes[userIndexes.length - keepRecentTurns] : 0;

  return messages.map((m, idx) => {
    if (idx >= cutoff) return m;
    if (!isToolResult(m)) return m;
    if (!opts.pruneToolNames.has(m.toolName)) return m;

    const text = toolText(m);
    if (text.length <= opts.maxToolChars) return m;

    return {
      ...m,
      content: [
        {
          type: "text",
          text:
            `(Pruned) ${m.toolName} tool output (${text.length} chars). ` +
            `Rehydrate by re-running the tool with narrower parameters.`,
        },
      ],
      details: {
        ...(m.details ?? {}),
        pruned: true,
        originalChars: text.length,
      },
    };
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/prune.ts tests/prune.test.ts
git commit -m "feat: add pruning helpers"
```

---

### Task 7: Add MCP client wrapper (KotaDB over stdio)

**Files:**
- Create: `src/kota/mcp.ts`
- Create: `tests/kota-mcp.test.ts`

**Step 1: Write the failing test**

Create `tests/kota-mcp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toTextContent } from "../src/kota/mcp.js";

describe("toTextContent", () => {
  it("joins text blocks", () => {
    expect(toTextContent([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/kota/mcp.js'`.

**Step 3: Write minimal implementation**

Create `src/kota/mcp.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function toTextContent(content: any[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const textBlocks = content.filter((b) => b?.type === "text" && typeof b.text === "string");
  return textBlocks.map((b) => b.text).join("\n");
}

export class KotaMcpClient {
  private client: Client | null = null;

  constructor(private readonly stdio: { command: string; args: string[]; cwd: string }) {}

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const transport = new StdioClientTransport({
      command: this.stdio.command,
      args: this.stdio.args,
      cwd: this.stdio.cwd,
      stderr: "pipe",
    });

    const client = new Client({ name: "pi-kota", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);

    this.client = client;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
  }

  async listTools(): Promise<string[]> {
    if (!this.client) throw new Error("MCP client not connected");
    const res = await this.client.listTools();
    return (res.tools ?? []).map((t: any) => String(t.name));
  }

  async callTool(name: string, args: any): Promise<{ content: any[]; raw: any }> {
    if (!this.client) throw new Error("MCP client not connected");
    const raw = await this.client.callTool({ name, arguments: args });
    return { content: raw?.content ?? [], raw };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/kota/mcp.ts tests/kota-mcp.test.ts
git commit -m "feat: add MCP client wrapper"
```

---

### Task 8: Add budgeted MCP tool-calls (friendly errors + truncation)

**Files:**
- Create: `src/kota/tools.ts`
- Create: `tests/kota-tools.test.ts`

**Step 1: Write the failing test**

Create `tests/kota-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatToolError } from "../src/kota/tools.js";

describe("formatToolError", () => {
  it("includes available tool list", () => {
    const msg = formatToolError("search", ["search", "deps"], new Error("boom"));
    expect(msg).toContain("Available MCP tools");
    expect(msg).toContain("search");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/kota/tools.js'`.

**Step 3: Write minimal implementation**

Create `src/kota/tools.ts`:

```ts
import { truncateChars } from "../text.js";
import { toTextContent } from "./mcp.js";

export function formatToolError(toolName: string, availableTools: string[], err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const list = availableTools.length ? availableTools.join(", ") : "(none)";
  return [
    `kota: failed to call MCP tool \"${toolName}\"`,
    `error: ${message}`,
    `Available MCP tools: ${list}`,
    `Hint: ensure bun/bunx is installed and KotaDB starts with --toolset core.`,
  ].join("\n");
}

export async function callBudgeted(opts: {
  toolName: string;
  args: any;
  maxChars: number;
  listTools: () => Promise<string[]>;
  callTool: (name: string, args: any) => Promise<{ content: any[]; raw: any }>;
}): Promise<{ text: string; raw: any; ok: boolean }> {
  try {
    const { content, raw } = await opts.callTool(opts.toolName, opts.args);
    const text = toTextContent(content);
    const fallback = JSON.stringify(raw, null, 2);
    return { text: truncateChars(text || fallback, opts.maxChars), raw, ok: true };
  } catch (e) {
    const available = await opts.listTools().catch(() => [] as string[]);
    return {
      text: truncateChars(formatToolError(opts.toolName, available, e), opts.maxChars),
      raw: null,
      ok: false,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/kota/tools.ts tests/kota-tools.test.ts
git commit -m "feat: add budgeted MCP calls"
```

---

### Task 9: Add indexing confirmation helper

**Files:**
- Create: `src/kota/ensure.ts`
- Create: `tests/kota-ensure.test.ts`

**Step 1: Write the failing test**

Create `tests/kota-ensure.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ensureIndexed } from "../src/kota/ensure.js";

describe("ensureIndexed", () => {
  it("calls index exactly once", async () => {
    const state = { indexed: false };
    const index = vi.fn(async () => {});

    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    expect(index).toHaveBeenCalledTimes(1);
    expect(state.indexed).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/kota/ensure.js'`.

**Step 3: Write minimal implementation**

Create `src/kota/ensure.ts`:

```ts
export async function ensureIndexed(opts: {
  state: { indexed: boolean };
  confirmIndex: boolean;
  confirm: (title: string, msg: string) => Promise<boolean>;
  index: () => Promise<void>;
}): Promise<void> {
  if (opts.state.indexed) return;

  if (opts.confirmIndex) {
    const ok = await opts.confirm(
      "Index repository?",
      "KotaDB indexing can take a while. Index this repository now?",
    );
    if (!ok) throw new Error("Indexing cancelled by user");
  }

  await opts.index();
  opts.state.indexed = true;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/kota/ensure.ts tests/kota-ensure.test.ts
git commit -m "feat: add ensureIndexed"
```

---

### Task 10: Implement extension runtime: /kota command + register working kota_* tools

**Files:**
- Create: `src/runtime.ts`
- Create: `src/kota/schemas.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialRuntimeState } from "../src/runtime.js";

describe("runtime", () => {
  it("starts disconnected and unindexed", () => {
    const s = createInitialRuntimeState();
    expect(s.kotaStatus).toBe("stopped");
    expect(s.indexed).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/runtime.js'`.

**Step 3: Write minimal implementation**

Create `src/runtime.ts`:

```ts
import type { PiKotaConfig } from "./config.js";
import type { KotaMcpClient } from "./kota/mcp.js";

export interface RuntimeState {
  config: PiKotaConfig | null;
  configSources: { global?: string; project?: string } | null;

  repoRoot: string | null;
  indexed: boolean;

  kotaStatus: "stopped" | "starting" | "running" | "error";
  lastError: string | null;

  mcp: KotaMcpClient | null;
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    config: null,
    configSources: null,

    repoRoot: null,
    indexed: false,

    kotaStatus: "stopped",
    lastError: null,

    mcp: null,
  };
}
```

Create `src/kota/schemas.ts`:

```ts
import { Type } from "@sinclair/typebox";

export const kotaIndexSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Repo root (defaults to detected repo root)" })),
});

export const kotaSearchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  output: Type.Optional(Type.String({ description: "paths|compact|snippet" })),
});

export const kotaDepsSchema = Type.Object({
  file_path: Type.String({ description: "Repo-relative file path" }),
  direction: Type.Optional(Type.String({ description: "dependencies|dependents|both" })),
  depth: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
  include_tests: Type.Optional(Type.Boolean()),
});

export const kotaUsagesSchema = Type.Object({
  symbol: Type.String(),
  file: Type.Optional(Type.String()),
  include_tests: Type.Optional(Type.Boolean()),
});

export const kotaImpactSchema = Type.Object({
  change_type: Type.String(),
  description: Type.String(),
  files_to_modify: Type.Optional(Type.Array(Type.String())),
  files_to_create: Type.Optional(Type.Array(Type.String())),
  files_to_delete: Type.Optional(Type.Array(Type.String())),
});

export const kotaTaskContextSchema = Type.Object({
  files: Type.Array(Type.String()),
  include_tests: Type.Optional(Type.Boolean()),
  include_symbols: Type.Optional(Type.Boolean()),
  max_impacted_files: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});
```

Now modify `src/index.ts` (replace entire file):

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { loadConfig } from "./config.js";
import { createInitialRuntimeState } from "./runtime.js";

import { KotaMcpClient } from "./kota/mcp.js";
import { callBudgeted } from "./kota/tools.js";
import { ensureIndexed } from "./kota/ensure.js";

import {
  kotaIndexSchema,
  kotaSearchSchema,
  kotaDepsSchema,
  kotaUsagesSchema,
  kotaImpactSchema,
  kotaTaskContextSchema,
} from "./kota/schemas.js";

async function detectRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  try {
    const res = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 3000 });
    if (res.code === 0) return res.stdout.trim();
  } catch {
    // ignore
  }
  return cwd;
}

export default function (pi: ExtensionAPI) {
  const state = createInitialRuntimeState();

  async function refreshConfig(ctx: any) {
    const res = await loadConfig({ cwd: ctx.cwd });
    state.config = res.config;
    state.configSources = res.sources;
  }

  async function ensureConnected(ctx: any): Promise<void> {
    if (!state.config) throw new Error("pi-kota: config not loaded");
    if (!state.repoRoot) state.repoRoot = await detectRepoRoot(pi, ctx.cwd);

    if (state.mcp?.isConnected()) {
      state.kotaStatus = "running";
      return;
    }

    state.kotaStatus = "starting";

    const client = new KotaMcpClient({
      command: state.config.kota.command,
      args: state.config.kota.args,
      cwd: state.repoRoot,
    });

    try {
      await client.connect();
      state.mcp = client;
      state.kotaStatus = "running";
      state.lastError = null;

      if (ctx.hasUI) {
        ctx.ui.setStatus("pi-kota", `kota: running | repo: ${state.repoRoot}`);
      }
    } catch (e: any) {
      state.kotaStatus = "error";
      state.lastError = e?.message ?? String(e);
      state.mcp = null;

      if (ctx.hasUI) {
        ctx.ui.setStatus("pi-kota", `kota: error (${state.lastError})`);
      }

      throw e;
    }
  }

  async function listToolsSafe(): Promise<string[]> {
    if (!state.mcp) return [];
    try {
      return await state.mcp.listTools();
    } catch {
      return [];
    }
  }

  async function callKotaTool(
    ctx: any,
    toolName: string,
    args: any,
  ): Promise<{ text: string; raw: any; ok: boolean }> {
    await ensureConnected(ctx);
    if (!state.config || !state.mcp) throw new Error("pi-kota: not connected");

    return callBudgeted({
      toolName,
      args,
      maxChars: 5000,
      listTools: () => state.mcp!.listTools(),
      callTool: (n, a) => state.mcp!.callTool(n, a),
    });
  }

  async function callKotaToolStrict(
    ctx: any,
    toolName: string,
    args: any,
  ): Promise<{ text: string; raw: any }> {
    const res = await callKotaTool(ctx, toolName, args);
    if (!res.ok) throw new Error(res.text);
    return res;
  }

  pi.on("session_start", async (_event, ctx) => {
    await refreshConfig(ctx);
    state.repoRoot = await detectRepoRoot(pi, ctx.cwd);

    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-kota", `kota: stopped | repo: ${state.repoRoot}`);
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    await state.mcp?.close().catch(() => {});
    state.mcp = null;
  });

  pi.registerCommand("kota", {
    description: "pi-kota commands (status/index/restart)",
    handler: async (args, ctx) => {
      const cmd = (args || "").trim();
      if (!ctx.hasUI) return;

      if (!cmd || cmd === "status") {
        const tools = await listToolsSafe();
        const src = state.configSources;
        ctx.ui.notify(
          [
            `pi-kota status`,
            `kota: ${state.kotaStatus}`,
            `repo: ${state.repoRoot ?? "(unknown)"}`,
            `indexed: ${state.indexed ? "yes" : "no"}`,
            `config: global=${src?.global ?? "(none)"}, project=${src?.project ?? "(none)"}`,
            tools.length ? `mcp tools: ${tools.join(", ")}` : "mcp tools: (unknown/unavailable)",
            state.lastError ? `lastError: ${state.lastError}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          "info",
        );
        return;
      }

      if (cmd === "reload-config") {
        await refreshConfig(ctx);
        ctx.ui.notify("Reloaded pi-kota config.", "info");
        return;
      }

      if (cmd === "restart") {
        await state.mcp?.close().catch(() => {});
        state.mcp = null;
        state.kotaStatus = "stopped";
        state.indexed = false;
        ctx.ui.notify("KotaDB connection reset. Next kota_* call will reconnect.", "info");
        return;
      }

      if (cmd === "index") {
        if (!state.config) throw new Error("pi-kota: config not loaded");
        await ensureConnected(ctx);

        let output = "";
        await ensureIndexed({
          state,
          confirmIndex: state.config.kota.confirmIndex,
          confirm: (t, m) => ctx.ui.confirm(t, m),
          index: async () => {
            const res = await callKotaToolStrict(ctx, "index", { path: state.repoRoot ?? ctx.cwd });
            output = res.text;
          },
        });

        ctx.ui.notify(output || "Index complete.", "info");
        return;
      }

      ctx.ui.notify(`Unknown /kota subcommand: ${cmd}`, "warning");
    },
  });

  // Tools (LLM-callable)
  pi.registerTool({
    name: "kota_index",
    label: "Kota: Index",
    description: "Ensure the current repository is indexed in KotaDB",
    parameters: kotaIndexSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!state.config) await refreshConfig(ctx);
      await ensureConnected(ctx);

      if (!state.config) throw new Error("pi-kota: config not loaded");

      const path = (params as any).path ?? state.repoRoot ?? ctx.cwd;
      const res = await callKotaToolStrict(ctx, "index", { path });
      state.indexed = true;

      return { content: [{ type: "text", text: res.text }], details: { indexed: true } };
    },
  });

  pi.registerTool({
    name: "kota_search",
    label: "Kota: Search",
    description: "Search code via KotaDB (bounded output)",
    parameters: kotaSearchSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureIndexed({
        state,
        confirmIndex: state.config.kota.confirmIndex,
        confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(false)),
        index: async () => {
          await callKotaToolStrict(ctx, "index", { path: state.repoRoot ?? ctx.cwd });
        },
      });

      const res = await callKotaTool(ctx, "search", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: res.ok } };
    },
  });

  pi.registerTool({
    name: "kota_deps",
    label: "Kota: Deps",
    description: "Dependency graph query via KotaDB (bounded output)",
    parameters: kotaDepsSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureIndexed({
        state,
        confirmIndex: state.config.kota.confirmIndex,
        confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(false)),
        index: async () => {
          await callKotaToolStrict(ctx, "index", { path: state.repoRoot ?? ctx.cwd });
        },
      });

      const res = await callKotaTool(ctx, "deps", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: res.ok } };
    },
  });

  pi.registerTool({
    name: "kota_usages",
    label: "Kota: Usages",
    description: "Symbol usages via KotaDB (bounded output)",
    parameters: kotaUsagesSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureIndexed({
        state,
        confirmIndex: state.config.kota.confirmIndex,
        confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(false)),
        index: async () => {
          await callKotaToolStrict(ctx, "index", { path: state.repoRoot ?? ctx.cwd });
        },
      });

      const res = await callKotaTool(ctx, "usages", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: res.ok } };
    },
  });

  pi.registerTool({
    name: "kota_impact",
    label: "Kota: Impact",
    description: "Impact analysis via KotaDB (bounded output)",
    parameters: kotaImpactSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureIndexed({
        state,
        confirmIndex: state.config.kota.confirmIndex,
        confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(false)),
        index: async () => {
          await callKotaToolStrict(ctx, "index", { path: state.repoRoot ?? ctx.cwd });
        },
      });

      const res = await callKotaTool(ctx, "impact", params);
      return {
        content: [{ type: "text", text: res.text }],
        details: { truncatedToChars: 5000, pinned: true, ok: res.ok },
      };
    },
  });

  pi.registerTool({
    name: "kota_task_context",
    label: "Kota: Task Context",
    description: "Summarize dependencies/impact for a small set of files (bounded output)",
    parameters: kotaTaskContextSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureIndexed({
        state,
        confirmIndex: state.config.kota.confirmIndex,
        confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(false)),
        index: async () => {
          await callKotaToolStrict(ctx, "index", { path: state.repoRoot ?? ctx.cwd });
        },
      });

      const res = await callKotaTool(ctx, "task_context", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: res.ok } };
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

Also run: `npm run typecheck`

Expected: Exit code 0.

**Step 5: Commit**

```bash
git add src/runtime.ts src/kota/schemas.ts src/index.ts tests/runtime.test.ts
git commit -m "feat: implement kota tools and /kota command"
```

---

### Task 11: Implement autoContext decision helper + hook (before_agent_start)

**Files:**
- Create: `src/autocontext.ts`
- Create: `tests/autocontext.test.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/autocontext.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldAutoInject } from "../src/autocontext.js";

describe("shouldAutoInject", () => {
  it("onPaths injects only for 1-3 paths", () => {
    expect(shouldAutoInject(["a/b.ts"], "onPaths")).toBe(true);
    expect(shouldAutoInject(["1", "2", "3", "4"], "onPaths")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/autocontext.js'`.

**Step 3: Write minimal implementation**

Create `src/autocontext.ts`:

```ts
import type { AutoContextMode } from "./config.js";

export function shouldAutoInject(paths: string[], mode: AutoContextMode): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return paths.length >= 1 && paths.length <= 3;
}
```

Modify `src/index.ts`:

1) Add imports at top:

```ts
import { extractFilePaths } from "./paths.js";
import { shouldAutoInject } from "./autocontext.js";
```

2) Add this handler near other `pi.on(...)` registrations:

```ts
pi.on("before_agent_start", async (event, ctx) => {
  if (!state.config) await refreshConfig(ctx);
  if (!state.config) return;

  const paths = extractFilePaths(event.prompt);
  if (!shouldAutoInject(paths, state.config.kota.autoContext)) return;

  // Use the same MCP path as tools (internal call; does not rely on LLM)
  try {
    const res = await callKotaTool(ctx, "task_context", { files: paths });
    return {
      message: {
        customType: "pi-kota:autoContext",
        content: `[pi-kota auto context]\nFiles: ${paths.join(", ")}\n\n${res.text}`,
        display: true,
      },
    };
  } catch {
    // If MCP isn’t available, fail open (no injection)
    return;
  }
});
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/autocontext.ts tests/autocontext.test.ts src/index.ts
git commit -m "feat: add autoContext injection hook"
```

---

### Task 12: Wire pruning into the `context` event (adaptive)

**Files:**
- Modify: `src/index.ts`

**Step 1: Write the failing test**

(Already covered by `tests/prune.test.ts`; this task is integration wiring.)

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: PASS (no failing unit tests yet), but pruning is not active.

**Step 3: Write minimal implementation**

Modify `src/index.ts`:

1) Add imports at top:

```ts
import { computePruneSettings, pruneContextMessages } from "./prune.js";
```

2) Add this handler near other `pi.on(...)` registrations:

```ts
pi.on("context", async (event, ctx) => {
  if (!state.config) return;
  if (!state.config.prune.enabled) return;

  const usage = ctx.getContextUsage?.();
  const base = {
    keepRecentTurns: state.config.prune.keepRecentTurns,
    maxToolChars: state.config.prune.maxToolChars,
  };

  const effective = state.config.prune.adaptive ? computePruneSettings(base, usage?.tokens) : base;

  const pruned = pruneContextMessages(event.messages as any[], {
    keepRecentTurns: effective.keepRecentTurns,
    maxToolChars: effective.maxToolChars,
    pruneToolNames: new Set(["read", "bash", "kota_search"]),
  });

  return { messages: pruned };
});
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: prune context via context event"
```

---

### Task 13: Truncate stored `kota_*` tool results + blob cache pointer (tool_result event)

**Files:**
- Create: `src/toolResult.ts`
- Create: `tests/toolResult.test.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/toolResult.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldTruncateToolResult } from "../src/toolResult.js";

describe("shouldTruncateToolResult", () => {
  it("only matches kota_*", () => {
    expect(shouldTruncateToolResult("kota_search")).toBe(true);
    expect(shouldTruncateToolResult("read")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL with `Cannot find module '../src/toolResult.js'`.

**Step 3: Write minimal implementation**

Create `src/toolResult.ts`:

```ts
export function shouldTruncateToolResult(toolName: string): boolean {
  return toolName.startsWith("kota_");
}
```

Modify `src/index.ts`:

1) Add imports at top:

```ts
import { shouldTruncateToolResult } from "./toolResult.js";
import { writeBlob } from "./blobs.js";
import { truncateChars } from "./text.js";
```

2) Add this handler near other `pi.on(...)` registrations:

```ts
pi.on("tool_result", async (event, _ctx) => {
  if (!state.config) return;
  if (!state.config.blobs.enabled) return;
  if (!shouldTruncateToolResult(event.toolName)) return;

  const textBlock = (event.content ?? []).find((b: any) => b?.type === "text" && typeof b.text === "string");
  const text = textBlock?.text ?? "";

  if (text.length <= state.config.prune.maxToolChars) return;

  const blob = await writeBlob({ dir: state.config.blobs.dir, content: text });
  const excerpt = truncateChars(text, state.config.prune.maxToolChars);

  const replacement =
    `${excerpt}\n\n` +
    `[pi-kota] Output truncated. Full output saved to blob:\n` +
    `- blobId: ${blob.blobId}\n` +
    `- blobPath: ${blob.blobPath}`;

  return {
    content: [{ type: "text", text: replacement }],
    details: {
      ...(event.details ?? {}),
      truncated: true,
      blobId: blob.blobId,
      blobPath: blob.blobPath,
      originalChars: text.length,
    },
  };
});
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/toolResult.ts tests/toolResult.test.ts src/index.ts
git commit -m "feat: truncate kota tool results with blob pointers"
```

---

### Task 14: Update README with install + usage + prerequisites

**Files:**
- Modify: `README.md`

**Step 1: Write the failing test**

N/A (docs only).

**Step 2: Run test to verify it fails**

N/A.

**Step 3: Write minimal implementation**

Update `README.md` to include:
- Bun requirement (`bun`, `bunx`)
- Where to place extension (`.pi/extensions/pi-kota/index.ts` or `~/.pi/agent/extensions/`)
- Commands: `/kota status`, `/kota index`, `/kota restart`, `/kota reload-config`
- Tools: `kota_index`, `kota_search`, `kota_deps`, `kota_usages`, `kota_impact`, `kota_task_context`

**Step 4: Run test to verify it passes**

Run: `npm test && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document bun requirement and extension usage"
```

---

### Task 15: Manual smoke test (end-to-end)

**Files:**
- (No code changes)

**Step 1: Write the failing test**

N/A.

**Step 2: Run test to verify it fails**

Run: `bun --version`

Expected: If this fails, install Bun before continuing.

**Step 3: Write minimal implementation**

Install Bun (system-appropriate method). Verify `bunx` is available.

**Step 4: Run test to verify it passes**

1) Start pi with this extension:

Run: `pi -e /home/pi/pi-kota/src/index.ts`

Expected: pi starts; footer status shows `kota: stopped | repo: ...`.

2) In pi:
- `/kota status`
Expected: notification with status + config sources.

3) Index:
- `/kota index`
Expected: confirmation dialog (if confirmIndex=true), then indexing.

4) Query:
- Ask the model to call `kota_search` with `{ "query": "export default" }`
Expected: bounded output; if long, output includes `[pi-kota] Output truncated...` and blob pointer.

5) Long-session sanity:
- Trigger multiple queries.
Expected: older large tool results are pruned/truncated rather than accumulating.

**Step 5: Commit**

N/A.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-10-pi-kota-extension-design.md`.

Two execution options:

1. Subagent-Driven (this session) — I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Parallel Session (separate) — Open a new session with the executing-plans skill, batch execution with checkpoints

Which approach?
