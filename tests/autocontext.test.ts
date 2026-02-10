import { describe, expect, it } from "vitest";
import { shouldAutoInject } from "../src/autocontext.js";

describe("shouldAutoInject", () => {
  it("onPaths injects only for 1-3 paths", () => {
    expect(shouldAutoInject(["a/b.ts"], "onPaths")).toBe(true);
    expect(shouldAutoInject(["1", "2", "3", "4"], "onPaths")).toBe(false);
  });
});
