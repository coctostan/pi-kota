import { describe, expect, it, vi } from "vitest";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { KotaMcpClient, toTextContent } from "../src/kota/mcp.js";

describe("toTextContent", () => {
  it("joins text blocks", () => {
    expect(toTextContent([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  });
});

describe("KotaMcpClient.connect error classification", () => {
  it("reports bun not found on PATH when spawn fails (ENOENT)", async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = "";

    const client = new KotaMcpClient({
      command: "bun",
      args: ["--version"],
      cwd: process.cwd(),
    });

    try {
      await expect(client.connect()).rejects.toThrow(/bun.*not found on PATH/i);
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      await client.close();
    }
  });

  it("reports bun not found on PATH when stderr indicates shebang env failure", async () => {
    const client = new KotaMcpClient({
      command: process.execPath,
      args: [
        "-e",
        "process.stderr.write('/usr/bin/env: bun: No such file or directory\\n'); process.exit(1);",
      ],
      cwd: process.cwd(),
    });

    try {
      await expect(client.connect()).rejects.toThrow(/bun.*not found on PATH/i);
    } finally {
      await client.close();
    }
  });

  it("reports bun not found on PATH when stderr says bun missing without env prefix", async () => {
    const client = new KotaMcpClient({
      command: process.execPath,
      args: [
        "-e",
        "process.stderr.write('bun: No such file or directory\\n'); process.exit(1);",
      ],
      cwd: process.cwd(),
    });

    try {
      await expect(client.connect()).rejects.toThrow(/bun.*not found on PATH/i);
    } finally {
      await client.close();
    }
  });

  it("does not classify non-bun missing-file stderr as bun-not-found", async () => {
    const client = new KotaMcpClient({
      command: process.execPath,
      args: [
        "-e",
        "process.stderr.write('bundle: No such file or directory\\n'); process.exit(1);",
      ],
      cwd: process.cwd(),
    });

    try {
      const connectError = await client.connect().then(
        () => null,
        (error) => error,
      );

      expect(connectError).toBeInstanceOf(Error);
      expect((connectError as Error).message).toMatch(/KotaDB subprocess failed/i);
      expect((connectError as Error).message).not.toMatch(/bun.*not found on PATH/i);
    } finally {
      await client.close();
    }
  });

  it("surfaces stderr when subprocess exits early", async () => {
    const client = new KotaMcpClient({
      command: process.execPath,
      args: ["-e", "process.stderr.write('boom\\n'); process.exit(1);"],
      cwd: process.cwd(),
    });

    try {
      await expect(client.connect()).rejects.toThrow(/boom/);
    } finally {
      await client.close();
    }
  });

  it("times out if the server never completes MCP connect", async () => {
    const closeDelayMs = 400;
    const timeoutMs = 20;
    const maxExpectedElapsedMs = 180;
    const originalClose = StdioClientTransport.prototype.close;
    const closeSpy = vi.spyOn(StdioClientTransport.prototype, "close").mockImplementation(async function (this: StdioClientTransport) {
      await new Promise((resolve) => setTimeout(resolve, closeDelayMs));
      return originalClose.call(this);
    });

    const client = new KotaMcpClient({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      connectTimeoutMs: timeoutMs,
    });

    try {
      const startedAt = Date.now();
      await expect(client.connect()).rejects.toThrow(/failed to start within/i);
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeLessThan(maxExpectedElapsedMs);
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
      await client.close();
    }
  });

  it("close() is idempotent", async () => {
    const client = new KotaMcpClient({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: process.cwd(),
      connectTimeoutMs: 50,
    });

    await client.close();
    await client.close();
  });
});
