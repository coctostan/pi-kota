import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "../src/config.js";

describe("config", () => {
  it("deep merges overrides into defaults", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      prune: { maxToolChars: 999 },
      blobs: { enabled: false },
    });

    expect(merged.prune.maxToolChars).toBe(999);
    expect(merged.blobs.enabled).toBe(false);
    expect(merged.prune.keepRecentTurns).toBe(DEFAULT_CONFIG.prune.keepRecentTurns);
  });

  it("defaults to bun x (not bunx)", () => {
    expect(DEFAULT_CONFIG.kota.command).toBe("bun");
    expect(DEFAULT_CONFIG.kota.args[0]).toBe("x");
    expect(DEFAULT_CONFIG.kota.args).toContain("kotadb@next");
  });

  it("includes a default connectTimeoutMs", () => {
    expect(DEFAULT_CONFIG.kota.connectTimeoutMs).toBeGreaterThan(0);
  });

  it("loads project config from projectRoot when cwd is nested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-kota-config-"));
    const nested = path.join(root, "a", "b");
    await mkdir(path.join(root, ".pi"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(root, ".pi", "pi-kota.json"),
      JSON.stringify({ prune: { maxToolChars: 777 } }),
      "utf8",
    );

    const { config, sources } = await loadConfig({ cwd: nested, projectRoot: root, homeDir: root });
    expect(config.prune.maxToolChars).toBe(777);
    expect(sources.project).toBe(path.join(root, ".pi", "pi-kota.json"));
  });
});
