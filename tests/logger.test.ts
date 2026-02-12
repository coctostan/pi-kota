import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("Logger", () => {
  it("writes JSON lines to the log file", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-log-")),
    );
    const logPath = path.join(dir, "debug.jsonl");
    const logger = await createLogger({ enabled: true, path: logPath });

    await logger.log("mcp", "connect", { repo: "/tmp/foo" });
    await logger.log("tool", "call", { name: "search" });
    await logger.close();

    const lines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines[0].category).toBe("mcp");
    expect(lines[0].event).toBe("connect");
    expect(lines[0].data).toEqual({ repo: "/tmp/foo" });
    expect(lines[0].ts).toBeDefined();
    expect(lines[1].category).toBe("tool");
  });

  it("is a silent no-op when disabled", async () => {
    const logger = await createLogger({ enabled: false });
    await logger.log("mcp", "connect", {});
    await logger.close();
  });

  it("never throws if the log path is unwritable", async () => {
    // Likely unwritable in CI/local as non-root.
    const logger = await createLogger({ enabled: true, path: "/root/pi-kota-debug.jsonl" });

    await expect(logger.log("mcp", "connected", { repo: "/tmp/repo" })).resolves.toBeUndefined();
    await expect(logger.close()).resolves.toBeUndefined();
  });
});
