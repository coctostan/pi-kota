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
    expect(merged.prune.keepRecentTurns).toBe(DEFAULT_CONFIG.prune.keepRecentTurns);
  });
});
