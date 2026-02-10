import { describe, expect, it } from "vitest";
import { formatToolError } from "../src/kota/tools.js";

describe("formatToolError", () => {
  it("includes available tool list", () => {
    const msg = formatToolError("search", ["search", "deps"], new Error("boom"));
    expect(msg).toContain("Available MCP tools");
    expect(msg).toContain("search");
  });

  it("uses bun-only installation hint", () => {
    const msg = formatToolError("search", ["search"], new Error("boom"));
    expect(msg).toContain("ensure bun is installed");
    expect(msg).not.toContain("bunx");
  });
});
