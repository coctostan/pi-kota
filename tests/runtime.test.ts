import path from "node:path";

import { describe, expect, it } from "vitest";
import { InFlightTracker, createInitialRuntimeState, normalizeRepoPath } from "../src/runtime.js";

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

describe("InFlightTracker", () => {
  it("tracks in-flight calls and resolves drain when all complete", async () => {
    const tracker = new InFlightTracker();
    expect(tracker.count).toBe(0);

    const release1 = tracker.acquire();
    const release2 = tracker.acquire();
    expect(tracker.count).toBe(2);

    release1();
    expect(tracker.count).toBe(1);

    const drainPromise = tracker.drain(500);
    release2();

    await drainPromise;
    expect(tracker.count).toBe(0);
  });

  it("drain resolves immediately when no calls in flight", async () => {
    const tracker = new InFlightTracker();
    await tracker.drain(100);
  });

  it("drain resolves after timeout even if calls remain", async () => {
    const tracker = new InFlightTracker();
    const release = tracker.acquire();
    const start = Date.now();
    await tracker.drain(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    release();
  });
});
