import { describe, expect, it, vi } from "vitest";
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

  it("does not call listTools for transport errors", async () => {
    const listTools = vi.fn(async () => ["search"]);
    const onTransportError = vi.fn();

    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools,
      callTool: async () => {
        const err = new Error("write EPIPE") as Error & { code: string };
        err.code = "EPIPE";
        throw err;
      },
      onTransportError,
    });

    expect(onTransportError).toHaveBeenCalledTimes(1);
    expect(listTools).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Available MCP tools: (none)");
  });

  it("falls back to JSON when no text blocks in MCP content", async () => {
    const raw = {
      content: [{ type: "image", uri: "file://diagram.png" }],
      meta: { source: "mcp" },
    };

    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => ["search"],
      callTool: async () => ({
        content: [{ type: "image", uri: "file://diagram.png" }],
        raw,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe(JSON.stringify(raw, null, 2));
  });

  it("truncates output to maxChars", async () => {
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5,
      listTools: async () => ["search"],
      callTool: async () => ({
        content: [{ type: "text", text: "abcdefgh" }],
        raw: { content: [{ type: "text", text: "abcdefgh" }] },
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toHaveLength(5);
    expect(result.text).toBe("abcd…");
  });
});
