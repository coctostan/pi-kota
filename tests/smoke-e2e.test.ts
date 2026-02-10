import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
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
