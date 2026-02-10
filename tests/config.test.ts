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

  it("uses defaults when no config files exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-kota-config-empty-"));

    const { config, sources } = await loadConfig({ cwd: root, projectRoot: root, homeDir: root });

    expect(config.kota.connectTimeoutMs).toBe(DEFAULT_CONFIG.kota.connectTimeoutMs);
    expect(config.prune.maxToolChars).toBe(DEFAULT_CONFIG.prune.maxToolChars);
    expect(config.blobs.enabled).toBe(DEFAULT_CONFIG.blobs.enabled);
    expect(sources.global).toBeUndefined();
    expect(sources.project).toBeUndefined();
  });

  it("falls back to defaults for invalid primitive override types", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-kota-config-invalid-"));
    await mkdir(path.join(root, ".pi"), { recursive: true });
    await writeFile(
      path.join(root, ".pi", "pi-kota.json"),
      JSON.stringify({
        kota: { connectTimeoutMs: "bad", confirmIndex: "no", command: 42, args: "x" },
        prune: { maxToolChars: "nope", enabled: "true", keepRecentTurns: "2", adaptive: "yes" },
        blobs: { enabled: "true", dir: 100 },
      }),
      "utf8",
    );

    const { config } = await loadConfig({ cwd: root, projectRoot: root, homeDir: root });

    expect(config.kota.connectTimeoutMs).toBe(DEFAULT_CONFIG.kota.connectTimeoutMs);
    expect(config.prune.maxToolChars).toBe(DEFAULT_CONFIG.prune.maxToolChars);
    expect(config.kota.confirmIndex).toBe(DEFAULT_CONFIG.kota.confirmIndex);
    expect(config.prune.enabled).toBe(DEFAULT_CONFIG.prune.enabled);
    expect(config.prune.keepRecentTurns).toBe(DEFAULT_CONFIG.prune.keepRecentTurns);
    expect(config.prune.adaptive).toBe(DEFAULT_CONFIG.prune.adaptive);
    expect(config.blobs.enabled).toBe(DEFAULT_CONFIG.blobs.enabled);
    expect(config.blobs.dir).toBe(path.join(root, ".pi/cache/pi-kota/blobs"));
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
