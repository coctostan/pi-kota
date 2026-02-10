import { describe, expect, it } from "vitest";
import { callBudgeted, formatToolError } from "../src/kota/tools.js";

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

describe("callBudgeted", () => {
  it("invokes onTransportError and returns ok=false on EPIPE", async () => {
    let onTransportErrorCalled = false;

    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => ["search"],
      callTool: async () => {
        const err = new Error("write EPIPE") as Error & { code: string };
        err.code = "EPIPE";
        throw err;
      },
      onTransportError: () => {
        onTransportErrorCalled = true;
      },
    });

    expect(onTransportErrorCalled).toBe(true);
    expect(result.ok).toBe(false);
  });
});
