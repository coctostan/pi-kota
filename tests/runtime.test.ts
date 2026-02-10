import { describe, expect, it } from "vitest";
import { createInitialRuntimeState, normalizeRepoPath } from "../src/runtime.js";

describe("runtime", () => {
  it("starts disconnected and unindexed", () => {
    const s = createInitialRuntimeState();
    expect(s.kotaStatus).toBe("stopped");
    expect(s.indexedRepoRoot).toBe(null);
  });

  it("normalizes repo paths for stable comparisons", () => {
    expect(normalizeRepoPath("/tmp/repo/../repo/")).toBe(normalizeRepoPath("/tmp/repo"));
  });
});
