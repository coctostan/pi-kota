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

  it("keeps valid global primitive when project override type is invalid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-kota-config-layered-"));
    await mkdir(path.join(root, ".pi", "agent"), { recursive: true });
    await writeFile(
      path.join(root, ".pi", "agent", "pi-kota.json"),
      JSON.stringify({ prune: { maxToolChars: 777 } }),
      "utf8",
    );

    await mkdir(path.join(root, ".pi"), { recursive: true });
    await writeFile(
      path.join(root, ".pi", "pi-kota.json"),
      JSON.stringify({ prune: { maxToolChars: "invalid" } }),
      "utf8",
    );

    const { config } = await loadConfig({ cwd: root, projectRoot: root, homeDir: root });

    expect(config.prune.maxToolChars).toBe(777);
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

  it("falls back for invalid enums, arrays, and out-of-range numbers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-kota-config-invalid-enums-"));
    await mkdir(path.join(root, ".pi"), { recursive: true });

    await writeFile(
      path.join(root, ".pi", "pi-kota.json"),
      JSON.stringify({
        kota: {
          toolset: "nope",
          autoContext: "bad",
          connectTimeoutMs: 0,
          confirmIndex: "no",
          command: "",
          args: ["ok", 1],
        },
        prune: { enabled: true, keepRecentTurns: -1, maxToolChars: 0, adaptive: "no" },
        blobs: { enabled: true, maxAgeDays: 0, maxSizeBytes: -1 },
        log: { enabled: true, path: "~/.pi/cache/pi-kota/custom.jsonl" },
      }),
      "utf8",
    );

    const { config } = await loadConfig({ cwd: root, projectRoot: root, homeDir: root });

    expect(config.kota.toolset).toBe(DEFAULT_CONFIG.kota.toolset);
    expect(config.kota.autoContext).toBe(DEFAULT_CONFIG.kota.autoContext);
    expect(config.kota.connectTimeoutMs).toBe(DEFAULT_CONFIG.kota.connectTimeoutMs);
    expect(config.kota.confirmIndex).toBe(DEFAULT_CONFIG.kota.confirmIndex);
    expect(config.kota.command).toBe(DEFAULT_CONFIG.kota.command);
    expect(config.kota.args).toEqual(DEFAULT_CONFIG.kota.args);

    expect(config.prune.keepRecentTurns).toBe(DEFAULT_CONFIG.prune.keepRecentTurns);
    expect(config.prune.maxToolChars).toBe(DEFAULT_CONFIG.prune.maxToolChars);
    expect(config.prune.adaptive).toBe(DEFAULT_CONFIG.prune.adaptive);

    // tilde expansion should be applied for log path
    expect(config.log.path).toBe(path.join(root, ".pi/cache/pi-kota/custom.jsonl"));
  });

  it("throws on invalid JSON (non-ENOENT read failure)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-kota-config-bad-json-"));
    await mkdir(path.join(root, ".pi"), { recursive: true });
    await writeFile(path.join(root, ".pi", "pi-kota.json"), "{ not-json ", "utf8");

    await expect(loadConfig({ cwd: root, projectRoot: root, homeDir: root })).rejects.toThrow();
  });
});
