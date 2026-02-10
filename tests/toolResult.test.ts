import { describe, expect, it } from "vitest";
import { shouldTruncateToolResult } from "../src/toolResult.js";

describe("shouldTruncateToolResult", () => {
  it("only matches kota_*", () => {
    expect(shouldTruncateToolResult("kota_search")).toBe(true);
    expect(shouldTruncateToolResult("read")).toBe(false);
  });
});
