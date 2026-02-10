import { describe, expect, it } from "vitest";
import { shouldAutoInject } from "../src/autocontext.js";

describe("shouldAutoInject", () => {
  it("onPaths injects only for 1-3 paths", () => {
    expect(shouldAutoInject(["a/b.ts"], "onPaths")).toBe(true);
    expect(shouldAutoInject(["1", "2", "3", "4"], "onPaths")).toBe(false);
  });

  it("off never injects even with extracted paths", () => {
    expect(shouldAutoInject(["src/paths.ts", "docs/design.md"], "off")).toBe(false);
  });

  it("always injects even with zero extracted paths", () => {
    expect(shouldAutoInject([], "always")).toBe(true);
  });
});
