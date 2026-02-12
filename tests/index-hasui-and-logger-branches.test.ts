import { describe, expect, it, vi } from "vitest";

const { getConfig } = vi.hoisted(() => {
  const config: any = {
    kota: {
      command: "kota",
      args: [],
      connectTimeoutMs: 10_000,
      confirmIndex: false,
      autoContext: "off",
    },
    prune: { enabled: false, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
    blobs: { enabled: false, dir: "/tmp/blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
    log: { enabled: true, path: "/tmp/should-not-write" },
  };
  return { getConfig: () => config };
});

vi.mock("../src/config.js", () => {
  return {
    loadConfig: vi.fn(async () => ({
      config: getConfig(),
      sources: { global: "(mock)", project: "(mock)" },
    })),
  };
});

const { behavior, resetBehavior } = vi.hoisted(() => {
  const behavior = { connectThrows: false };
  return {
    behavior,
    resetBehavior: () => {
      behavior.connectThrows = false;
    },
  };
});

vi.mock("../src/kota/mcp.js", () => {
  function toTextContent(content: unknown[] | undefined): string {
    if (!Array.isArray(content)) return "";
    return content
      .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
      .map((b: any) => b.text)
      .join("\n");
  }

  class KotaMcpClient {
    connected = false;
    constructor(_opts: any) {}
    async connect() {
      if (behavior.connectThrows) throw new Error("connect failed");
      this.connected = true;
    }
    isConnected() {
      return this.connected;
    }
    async listTools() {
      return ["index_repository", "search"];
    }
    async callTool(name: string, _args: any) {
      return { content: [{ type: "text", text: `${name}: ok` }], raw: { ok: true } };
    }
    disconnect() {
      this.connected = false;
    }
    async close() {
      this.connected = false;
    }
  }

  return { KotaMcpClient, toTextContent };
});

// Force inner logger to throw so makeSafeLogger catch branches are covered.
vi.mock("../src/logger.js", () => {
  return {
    createLogger: vi.fn(async () => ({
      async log() {
        throw new Error("logger write failed");
      },
      async close() {
        throw new Error("logger close failed");
      },
    })),
  };
});

import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

function installGitExecMocks(api: any, head: string) {
  api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
      return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
    }
    if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
      return { code: 0, stdout: head + "\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "" };
  });
}

describe("index.ts hasUI/logger branches", () => {
  it("covers hasUI=false paths and safe-logger swallow", async () => {
    resetBehavior();

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctxNoUI: any = {
      cwd: process.cwd(),
      hasUI: false,
      ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn(async () => true) },
    };

    // session_start should NOT call ui.setStatus when hasUI=false.
    await api.fire("session_start", {}, ctxNoUI);
    expect(ctxNoUI.ui.setStatus).not.toHaveBeenCalled();

    // First search triggers connect + index.
    const search = api.tools.get("kota_search");
    await search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctxNoUI);

    // Second search with new HEAD triggers staleness logic, but hasUI=false => no notify.
    installGitExecMocks(api, "HEAD-2");
    await search.execute("id", { query: "y", output: "paths", limit: 1 }, undefined, undefined, ctxNoUI);
    expect(ctxNoUI.ui.notify).not.toHaveBeenCalled();

    // /kota command should early-return when hasUI=false.
    const kotaCmd = api.commands.get("kota");
    await kotaCmd.handler("status", ctxNoUI);

    // shutdown should not throw even though inner logger.close() throws.
    await api.fire("session_shutdown", {}, ctxNoUI);
  });

  it("covers ensureConnected connect_error branch with hasUI=false", async () => {
    resetBehavior();
    behavior.connectThrows = true;

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctxNoUI: any = { cwd: process.cwd(), hasUI: false, ui: { setStatus: vi.fn() } };
    await api.fire("session_start", {}, ctxNoUI);

    const search = api.tools.get("kota_search");
    await expect(
      search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctxNoUI),
    ).rejects.toThrow(/connect failed/);

    // hasUI=false => no status updates
    expect(ctxNoUI.ui.setStatus).not.toHaveBeenCalled();

    await api.fire("session_shutdown", {}, ctxNoUI);
  });
});
