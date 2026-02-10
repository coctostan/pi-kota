import { describe, expect, it } from "vitest";

describe("e2e smoke (bootstrap)", () => {
  it("is discovered by vitest.config.e2e.ts", () => {
    // This should fail until we wire up the e2e config + script correctly.
    expect(true).toBe(false);
  });
});
