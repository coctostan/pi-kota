import { describe, expect, it } from "vitest";
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
});
