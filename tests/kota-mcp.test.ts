import { describe, expect, it } from "vitest";
import { toTextContent } from "../src/kota/mcp.js";

describe("toTextContent", () => {
  it("joins text blocks", () => {
    expect(toTextContent([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  });
});
