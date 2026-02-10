import { describe, expect, it } from "vitest";
import { createInitialRuntimeState } from "../src/runtime.js";

describe("runtime", () => {
  it("starts disconnected and unindexed", () => {
    const s = createInitialRuntimeState();
    expect(s.kotaStatus).toBe("stopped");
    expect(s.indexed).toBe(false);
  });
});
