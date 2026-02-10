import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

const HAS_BUNX = (() => {
  try {
    execFileSync("bunx", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const e2eDescribe = HAS_BUNX ? describe : describe.skip;

function makeCtx(overrides?: Partial<any>) {
  return {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    getContextUsage: () => ({ tokens: 5000 }),
    ...overrides,
  };
}

async function setupE2eConfig(repoRoot = process.cwd()) {
  const piDir = path.join(repoRoot, ".pi");
  const blobDir = path.join(repoRoot, ".tmp/e2e-blobs");

  await fs.mkdir(piDir, { recursive: true });
  await fs.mkdir(blobDir, { recursive: true });

  await fs.writeFile(
    path.join(piDir, "pi-kota.json"),
    JSON.stringify(
      {
        kota: { confirmIndex: true },
        prune: { enabled: true, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
        blobs: { enabled: true, dir: blobDir },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function rmSafe(p: string) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

afterAll(async () => {
  const repoRoot = process.cwd();
  const piDir = path.join(repoRoot, ".pi");
  const tmpDir = path.join(repoRoot, ".tmp");

  await rmSafe(piDir);
  await rmSafe(tmpDir);

  expect(await pathExists(piDir)).toBe(false);
  expect(await pathExists(tmpDir)).toBe(false);
});

describe("e2e smoke (wiring)", () => {
  it("registers all pi-kota tools and the /kota command", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    expect([...api.tools.keys()].sort()).toEqual(
      [
        "kota_deps",
        "kota_impact",
        "kota_index",
        "kota_search",
        "kota_task_context",
        "kota_usages",
      ].sort(),
    );

    expect(api.commands.has("kota")).toBe(true);
  });
});

describe("e2e smoke (lifecycle)", () => {
  it("session_start loads config and sets initial status", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const repoRoot = process.cwd();
    await setupE2eConfig(repoRoot);

    const ctx = makeCtx({ cwd: repoRoot });

    await api.fire("session_start", {}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalled();
    const calls = ctx.ui.setStatus.mock.calls;
    const combined = calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(combined).toContain("kota: stopped");
  });
});

e2eDescribe("e2e smoke (real kotadb)", () => {
  it(
    "runs core tools end-to-end",
    async () => {
      const api = createMockApi();
      extension(api.pi as any);

      const cwd = process.cwd();
      await setupE2eConfig(cwd);
      const ctx = makeCtx({ cwd });

      try {
        await api.fire("session_start", {}, ctx);

        const searchTool = api.tools.get("kota_search");
        const depsTool = api.tools.get("kota_deps");
        const usagesTool = api.tools.get("kota_usages");
        const impactTool = api.tools.get("kota_impact");

        expect(searchTool).toBeTruthy();
        expect(depsTool).toBeTruthy();
        expect(usagesTool).toBeTruthy();
        expect(impactTool).toBeTruthy();

        const searchRes = await searchTool.execute(
          "id",
          { query: "loadConfig", output: "paths", limit: 10 },
          undefined,
          undefined,
          ctx,
        );
        const searchText = String(searchRes.content?.[0]?.text ?? "");
        expect(searchText.length).toBeGreaterThan(0);

        const depsRes = await depsTool.execute(
          "id",
          { file_path: "src/index.ts", direction: "dependencies", depth: 1 },
          undefined,
          undefined,
          ctx,
        );
        const depsText = String(depsRes.content?.[0]?.text ?? "");
        expect(depsText.length).toBeGreaterThan(0);

        const usagesRes = await usagesTool.execute("id", { symbol: "loadConfig" }, undefined, undefined, ctx);
        const usagesText = String(usagesRes.content?.[0]?.text ?? "");
        expect(usagesText.length).toBeGreaterThan(0);

        const impactRes = await impactTool.execute(
          "id",
          { change_type: "refactor", description: "smoke test" },
          undefined,
          undefined,
          ctx,
        );
        expect(impactRes.details?.pinned).toBe(true);
      } finally {
        await api.fire("session_shutdown", {}, ctx);
      }
    },
    120_000,
  );
});

describe("e2e smoke (prune + blobs)", () => {
  it("prunes old tool results on context event", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const cwd = process.cwd();
    await setupE2eConfig(cwd);
    const ctx = makeCtx({ cwd });

    await api.fire("session_start", {}, ctx);

    const long = "x".repeat(200);
    const messages = [
      { role: "user", content: [{ type: "text", text: "turn1" }] },
      { role: "toolResult", toolName: "kota_search", content: [{ type: "text", text: long }] },
      { role: "user", content: [{ type: "text", text: "turn2" }] },
      { role: "toolResult", toolName: "read", content: [{ type: "text", text: long }] },
      { role: "user", content: [{ type: "text", text: "turn3" }] },
    ];

    const [res] = await api.fire("context", { messages }, ctx);
    const pruned = (res?.messages ?? []) as any[];

    const firstTool = pruned.find((m) => m?.role === "toolResult" && m?.toolName === "kota_search");
    expect(firstTool?.details?.pruned).toBe(true);
    expect(String(firstTool?.content?.[0]?.text ?? "")).toContain("(Pruned)");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("writes a blob + truncates tool_result output", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const cwd = process.cwd();
    await setupE2eConfig(cwd);
    const ctx = makeCtx({ cwd });
    await api.fire("session_start", {}, ctx);

    const big = "y".repeat(500);
    const [res] = await api.fire(
      "tool_result",
      {
        toolName: "kota_search",
        content: [{ type: "text", text: big }],
        details: {},
      },
      ctx,
    );

    expect(String(res?.content?.[0]?.text ?? "")).toContain("Output truncated");
    expect(res?.details?.truncated).toBe(true);
    expect(String(res?.details?.blobPath ?? "")).toContain(".tmp/e2e-blobs");

    await api.fire("session_shutdown", {}, ctx);
  });
});
