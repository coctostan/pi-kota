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

describe("callBudgeted edge cases", () => {
  it("handles empty content array from MCP", async () => {
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => ["search"],
      callTool: async () => ({
        content: [],
        raw: { content: [] },
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('"content"');
  });

  it("truncates huge error messages to maxChars", async () => {
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 50,
      listTools: async () => ["search"],
      callTool: async () => {
        throw new Error("E".repeat(1000));
      },
    });

    expect(result.ok).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(50);
    expect(result.text).toMatch(/…$/);
  });

  it("handles ECONNRESET as transport error", async () => {
    let transportErrorFired = false;
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => [],
      callTool: async () => {
        const err = new Error("read ECONNRESET") as Error & { code: string };
        err.code = "ECONNRESET";
        throw err;
      },
      onTransportError: () => {
        transportErrorFired = true;
      },
    });

    expect(transportErrorFired).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("handles ERR_STREAM_DESTROYED as transport error", async () => {
    let transportErrorFired = false;
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools: async () => [],
      callTool: async () => {
        const err = new Error("stream destroyed") as Error & { code: string };
        err.code = "ERR_STREAM_DESTROYED";
        throw err;
      },
      onTransportError: () => {
        transportErrorFired = true;
      },
    });

    expect(transportErrorFired).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("treats non-transport errors as recoverable (lists tools)", async () => {
    const listTools = vi.fn(async () => ["search", "deps"]);
    const result = await callBudgeted({
      toolName: "search",
      args: {},
      maxChars: 5000,
      listTools,
      callTool: async () => {
        throw new Error("some random error");
      },
    });

    expect(listTools).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("search, deps");
  });
});
