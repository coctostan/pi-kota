# Bun PATH Resilience Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.
>
> **Status note:** Implemented on branch `feat/bun-path-resilience`. Where this plan’s inline sketch code differs, treat repository code/tests (`scripts/check-bun.js`, `src/kota/mcp.ts`, `tests/*`) as the source of truth.

**Goal:** Make pi-kota’s Bun dependency resilient: avoid `bunx`/shebang PATH failures, warn at install time if Bun isn’t discoverable, and surface actionable runtime errors when KotaDB can’t start.

**Architecture:** (1) Switch the default KotaDB spawn command from `bunx` to `bun x …` to eliminate “bunx exists but bun isn’t on PATH” failures. (2) Add a `postinstall` Node script that checks `bun` availability and prints a non-blocking warning with PATH remediation. (3) Improve `KotaMcpClient.connect()` error classification by capturing early stderr and translating common spawn/exit failures into actionable messages.

**Tech Stack:** Node.js (ESM, this repo is `"type": "module"`), TypeScript, Vitest, `@modelcontextprotocol/sdk` (stdio transport).

---

## Pre-flight (one-time)

- Run tests: `npm test`
- Typecheck: `npm run typecheck`

Notes for implementer:
- This repo uses ESM. Any new `.js` scripts must use `import … from` (not `require`).
- Prefer small commits per task.

---

### Task 1: Default spawn command uses `bun x` (config + unit test)

**Files:**
- Modify: `tests/config.test.ts`
- Modify: `src/config.ts` (current defaults at `command: "bunx"` / `args: ["kotadb@next", …]`)

**Step 1: Write the failing test**

In `tests/config.test.ts`, add a new test that asserts the default command is `bun` and args start with `x`.

```ts
it("defaults to bun x (not bunx)", () => {
  expect(DEFAULT_CONFIG.kota.command).toBe("bun");
  expect(DEFAULT_CONFIG.kota.args[0]).toBe("x");
  expect(DEFAULT_CONFIG.kota.args).toContain("kotadb@next");
});
```

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/config.test.ts`

Expected: FAIL (because default config still uses `bunx`).

**Step 3: Write minimal implementation**

In `src/config.ts`, change the defaults:

```ts
command: "bun",
args: ["x", "kotadb@next", "--stdio", "--toolset", "core"],
```

**Step 4: Run test to verify it passes**

Run:
- `npm test -- tests/config.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/config.test.ts src/config.ts
git commit -m "feat: default to bun x for kotadb spawn"
```

---

### Task 2: Update E2E smoke gating from `bunx` to `bun`

**Files:**
- Modify: `tests/smoke-e2e.test.ts` (currently checks `bunx --version` and skips real-kotadb tests if absent)

**Step 1: Write the failing test (adjust expectation first)**

This is a small refactor; the “failing test” is the suite itself. First update the constant name + command used:
- Rename `HAS_BUNX` → `HAS_BUN`
- Change `execFileSync("bunx", …)` → `execFileSync("bun", …)`
- Change `e2eDescribe` to use `HAS_BUN`

(You can do this directly; the next step verifies the suite still behaves.)

**Step 2: Run test to verify current behavior is broken until code is updated**

Run:
- `npm test -- tests/smoke-e2e.test.ts`

Expected: Depending on your machine:
- If `bun` is installed: the “real kotadb” describe block should *not* be skipped.
- If `bun` is not installed: it should be skipped.

(If you still see it skipping even with bun installed, you missed a reference to `HAS_BUNX`.)

**Step 3: Minimal implementation**

Update the gating block:

```ts
const HAS_BUN = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const e2eDescribe = HAS_BUN ? describe : describe.skip;
```

**Step 4: Run test to verify it passes**

Run:
- `npm test -- tests/smoke-e2e.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/smoke-e2e.test.ts
git commit -m "test: gate e2e kotadb smoke tests on bun"
```

---

### Task 3: Add `scripts/check-bun.js` postinstall check (with tests)

**Files:**
- Create: `scripts/check-bun.js`
- Create: `tests/check-bun.test.ts`
- Modify: `package.json` (add `postinstall`)

**Step 1: Write the failing test**

Create `tests/check-bun.test.ts` that runs `node scripts/check-bun.js` in subprocesses with controlled PATH.

Key idea: don’t depend on real Bun being installed. Create temporary directories with fake executables.

Skeleton:

```ts
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function makeExe(dir: string, name: string, content: string) {
  const p = path.join(dir, name);
  await fs.writeFile(p, content, "utf8");
  await fs.chmod(p, 0o755);
  return p;
}

describe("postinstall bun check", () => {
  it("prints warning when bun is missing but bunx exists (PATH issue)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-buncheck-"));
    const bin = path.join(tmp, "bin");
    const bunHome = path.join(tmp, "bun-home");
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(bunHome, { recursive: true });

    const bun = await makeExe(
      bunHome,
      "bun",
      "#!/usr/bin/env node\nconsole.log('1.0.0');\n",
    );

    // bunx is a symlink to bun (matches the real-world failure mode)
    await fs.symlink(bun, path.join(bin, "bunx"));

    const res = spawnSync(
      process.execPath,
      ["scripts/check-bun.js"],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: bin },
        encoding: "utf8",
      },
    );

    expect(res.status).toBe(0);
    expect(res.stdout + res.stderr).toContain("pi-kota");
    expect(res.stdout + res.stderr).toContain("'bun' is not on PATH");
    expect(res.stdout + res.stderr).toContain("export PATH=");
  });

  it("is silent when bun is on PATH", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-buncheck-"));
    const bin = path.join(tmp, "bin");
    await fs.mkdir(bin, { recursive: true });

    await makeExe(bin, "bun", "#!/usr/bin/env node\nconsole.log('1.0.0');\n");

    const res = spawnSync(process.execPath, ["scripts/check-bun.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: bin },
      encoding: "utf8",
    });

    expect(res.status).toBe(0);
    expect((res.stdout + res.stderr).trim()).toBe("");
  });
});
```

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/check-bun.test.ts`

Expected: FAIL because `scripts/check-bun.js` does not exist yet.

**Step 3: Write minimal implementation**

Create `scripts/check-bun.js` (ESM) implementing:
- Try `bun --version` (silent success)
- If missing:
  - If `bunx` exists on PATH, resolve symlink via `fs.realpathSync` to suggest PATH fix and/or symlink `bun`
  - Else print install instructions
- Always `process.exit(0)` (non-blocking)

Minimal (outline):

```js
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function findOnPath(bin) {
  const PATH = process.env.PATH ?? "";
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // continue
    }
  }
  return null;
}

function tryExec(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (tryExec("bun", ["--version"])) {
  process.exit(0);
}

const bunxPath = findOnPath("bunx");

if (bunxPath) {
  let resolved = bunxPath;
  try {
    resolved = fs.realpathSync(bunxPath);
  } catch {
    // ignore
  }

  const bunDir = path.dirname(resolved);

  const msg = [
    "\n  ⚠  pi-kota: 'bun' is not on PATH\n",
    `  Found bunx at: ${bunxPath}`,
    `  Which resolves to: ${resolved}\n`,
    "  Add bun's directory to your PATH:",
    `    export PATH=\"${bunDir}:$PATH\"\n`,
    "  Or symlink it:",
    `    ln -s ${resolved} ${path.join(path.dirname(bunxPath), "bun")}\n`,
    "  Current PATH:",
    `    ${process.env.PATH ?? ""}\n",
  ].join("\n");

  process.stderr.write(msg);
  process.exit(0);
}

process.stderr.write(
  [
    "\n  ⚠  pi-kota: bun runtime not found\n",
    "  pi-kota requires bun to run KotaDB. Install it:",
    "    curl -fsSL https://bun.sh/install | bash\n",
    "  Then restart your terminal or run:",
    "    source ~/.bashrc\n",
  ].join("\n"),
);
process.exit(0);
```

**Step 4: Run test to verify it passes**

Run:
- `npm test -- tests/check-bun.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/check-bun.js tests/check-bun.test.ts
git commit -m "chore: add postinstall bun availability warning"
```

---

### Task 4: Wire postinstall into npm lifecycle

**Files:**
- Modify: `package.json`

**Step 1: Write the failing test (lightweight)**

There’s no existing test harness for npm lifecycle scripts; instead, verify via a deterministic command.

Add the `postinstall` script first, then validate the script runs manually.

**Step 2: Run check script manually to see it works**

Run:
- `node scripts/check-bun.js`

Expected:
- If bun is on PATH: no output, exit code 0.
- If bun missing: warning text, exit code 0.

**Step 3: Minimal implementation**

In `package.json`, add:

```json
"postinstall": "node scripts/check-bun.js"
```

(Keep existing scripts unchanged.)

**Step 4: Run unit tests**

Run:
- `npm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add postinstall bun check"
```

---

### Task 5: Improve runtime error messages from `KotaMcpClient.connect()` (with tests)

**Files:**
- Modify: `tests/kota-mcp.test.ts`
- Modify: `src/kota/mcp.ts`

**Step 1: Write the failing tests**

Extend `tests/kota-mcp.test.ts` with connect error classification cases.

```ts
import { KotaMcpClient } from "../src/kota/mcp.js";

describe("KotaMcpClient.connect error classification", () => {
  it("reports bun not found on PATH when spawn fails (ENOENT)", async () => {
    const oldPath = process.env.PATH;
    process.env.PATH = "";

    const client = new KotaMcpClient({ command: "bun", args: ["--version"], cwd: process.cwd() });

    await expect(client.connect()).rejects.toThrow(/bun.*not found on PATH/i);

    process.env.PATH = oldPath;
  });

  it("reports bun not found on PATH when stderr indicates shebang env failure", async () => {
    const client = new KotaMcpClient({
      command: "node",
      args: [
        "-e",
        "process.stderr.write('/usr/bin/env: bun: No such file or directory\\n'); process.exit(1);",
      ],
      cwd: process.cwd(),
    });

    await expect(client.connect()).rejects.toThrow(/bun.*not found on PATH/i);
  });

  it("surfaces stderr when subprocess exits early", async () => {
    const client = new KotaMcpClient({
      command: "node",
      args: ["-e", "process.stderr.write('boom\\n'); process.exit(1);"],
      cwd: process.cwd(),
    });

    await expect(client.connect()).rejects.toThrow(/boom/);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/kota-mcp.test.ts`

Expected: FAIL (connect currently just throws MCP “Connection closed” / raw spawn errors).

**Step 3: Write minimal implementation**

In `src/kota/mcp.ts`:

1) Create `StdioClientTransport` as today, but attach a stderr listener *before* connecting.
2) Buffer stderr (e.g., cap at ~8–16KB) so early error output is not lost.
3) Wrap `client.connect(transport)` in `try/catch` and translate:
   - Spawn ENOENT for command `bun` → `pi-kota: 'bun' not found on PATH. Install bun (https://bun.sh) or check your PATH.`
   - Captured stderr containing env/shebang bun failures (match `/env: bun/`, `bun: not found`, `No such file or directory` + `bun`) → same message.
   - Otherwise, if stderr captured: `pi-kota: KotaDB subprocess failed — <stderr snippet>`

Implementation sketch:

```ts
const stderrBuf: string[] = [];
const stderr = transport.stderr;
stderr?.on("data", (c) => {
  const s = String(c);
  stderrBuf.push(s);
  // cap
  if (stderrBuf.join("").length > 16_000) stderrBuf.shift();
});

try {
  await client.connect(transport);
} catch (e) {
  const stderrText = stderrBuf.join("").trim();
  // classify + throw new Error(...)
}
```

Important: keep the successful path unchanged; only improve the error thrown.

**Step 4: Run test to verify it passes**

Run:
- `npm test -- tests/kota-mcp.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/kota/mcp.ts tests/kota-mcp.test.ts
git commit -m "feat: classify kotadb startup failures with actionable bun errors"
```

---

### Task 6: Update user-facing hints + README documentation

**Files:**
- Modify: `src/kota/tools.ts` (error hint string)
- Modify: `tests/kota-tools.test.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

In `tests/kota-tools.test.ts`, add an assertion that the hint mentions `bun` (not `bunx`).

```ts
expect(msg).toContain("ensure bun is installed");
expect(msg).not.toContain("bunx");
```

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/kota-tools.test.ts`

Expected: FAIL (current hint says `bun/bunx`).

**Step 3: Minimal implementation**

Update `src/kota/tools.ts` hint line to something like:

```ts
"Hint: ensure bun is installed and KotaDB starts with --toolset core.",
```

Update `README.md`:
- In **Prerequisites**, remove `bunx --version` and keep `bun --version`.
- In **Default Config**, update to:
  - `"command": "bun"`
  - `"args": ["x", "kotadb@next", "--stdio", "--toolset", "core"]`

**Step 4: Run tests to verify they pass**

Run:
- `npm test`
- `npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/kota/tools.ts tests/kota-tools.test.ts README.md
git commit -m "docs: document bun x default and simplify bun prerequisite"
```

---

## Final verification (required before calling it done)

Run:
- `npm test`
- `npm run typecheck`

Expected:
- All unit tests pass.
- Typecheck passes.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-10-bun-path-resilience-design.md`. Two execution options:

1. Subagent-Driven (this session) — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) — Open a new session with executing-plans, batch execution with checkpoints

Which approach?