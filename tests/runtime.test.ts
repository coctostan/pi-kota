import path from "node:path";

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

  it("resolves relative paths against provided base directory", () => {
    const baseDir = "/tmp/workspace/project";
    const expected = path.normalize("/tmp/workspace/repo");

    expect(normalizeRepoPath("../repo", baseDir)).toBe(expected);
    expect(normalizeRepoPath("../repo/", baseDir)).toBe(expected);
    expect(normalizeRepoPath("../project/../repo", baseDir)).toBe(expected);
  });
});
