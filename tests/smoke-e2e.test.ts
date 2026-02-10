import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

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

    const ctx = makeCtx({ cwd: repoRoot });

    await api.fire("session_start", {}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalled();
    const calls = ctx.ui.setStatus.mock.calls;
    const combined = calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(combined).toContain("kota: stopped");
  });
});
