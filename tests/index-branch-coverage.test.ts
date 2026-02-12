import { describe, expect, it, vi } from "vitest";

const { getConfig, setConfig } = vi.hoisted(() => {
  let config: any = {
    kota: {
      command: "kota",
      args: [],
      connectTimeoutMs: 10_000,
      confirmIndex: false,
      autoContext: "off",
    },
    prune: { enabled: false, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
    blobs: { enabled: false, dir: "/tmp/blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
    log: { enabled: false, path: "/dev/null" },
  };

  return {
    getConfig: () => config,
    setConfig: (c: any) => {
      config = c;
    },
  };
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
  const behavior = {
    connectThrows: false,
    listToolsThrows: false,
    callToolThrows: false,
  };
  return {
    behavior,
    resetBehavior: () => {
      behavior.connectThrows = false;
      behavior.listToolsThrows = false;
      behavior.callToolThrows = false;
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
      if (behavior.listToolsThrows) throw new Error("listTools failed");
      return [
        "index_repository",
        "search",
        "search_dependencies",
        "find_usages",
        "analyze_change_impact",
        "generate_task_context",
      ];
    }
    async callTool(name: string, _args: any) {
      if (behavior.callToolThrows) throw new Error("callTool failed");
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

const { evictSpy } = vi.hoisted(() => {
  const evictSpy = vi.fn(async () => ({ removedCount: 2, removedBytes: 123 }));
  return { evictSpy };
});

vi.mock("../src/blobs-evict.js", () => ({ evictBlobs: evictSpy }));

import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

function makeCtx() {
  return {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    getContextUsage: vi.fn(() => ({ tokens: 50_000 })),
  } as any;
}

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

describe("index.ts branch coverage", () => {
  it("before_agent_start injects auto context when enabled", async () => {
    resetBehavior();
    setConfig({
      ...getConfig(),
      kota: { ...getConfig().kota, autoContext: "always", confirmIndex: false },
      blobs: { ...getConfig().blobs, enabled: false },
      prune: { ...getConfig().prune, enabled: false },
    });

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const [res] = await api.fire(
      "before_agent_start",
      { prompt: "please look at src/index.ts and src/runtime.ts" },
      ctx,
    );

    expect(res?.message?.customType).toBe("pi-kota:autoContext");
    expect(String(res?.message?.content)).toContain("src/index.ts");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("before_agent_start swallows errors from MCP/tooling", async () => {
    resetBehavior();
    behavior.callToolThrows = true;
    setConfig({
      ...getConfig(),
      kota: { ...getConfig().kota, autoContext: "always", confirmIndex: false },
    });

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const [res] = await api.fire("before_agent_start", { prompt: "check src/index.ts" }, ctx);
    expect(res).toBeUndefined();

    await api.fire("session_shutdown", {}, ctx);
  });

  it("connect failure sets kota status to error (UI status updated)", async () => {
    resetBehavior();
    behavior.connectThrows = true;

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const search = api.tools.get("kota_search");
    await expect(
      search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctx),
    ).rejects.toThrow(/connect failed/);

    // ensureConnected error path updates status.
    expect(ctx.ui.setStatus).toHaveBeenCalled();
    const statusStrings = ctx.ui.setStatus.mock.calls.map((c: any[]) => String(c[1]));
    expect(statusStrings.join("\n")).toContain("error");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("context handler prunes when enabled", async () => {
    resetBehavior();
    setConfig({
      ...getConfig(),
      prune: { enabled: true, keepRecentTurns: 1, maxToolChars: 10, adaptive: true },
    });

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const longToolText = "z".repeat(200);
    const event = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok" },
        { role: "assistant", toolName: "kota_search", content: longToolText },
        { role: "assistant", content: "more" },
      ],
    };

    const [res] = await api.fire("context", event, ctx);
    expect(res?.messages).toBeTruthy();
    expect(Array.isArray(res.messages)).toBe(true);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("/kota status handles listTools failure", async () => {
    resetBehavior();

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    // Connect once so state.mcp is set.
    const search = api.tools.get("kota_search");
    await search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctx);

    behavior.listToolsThrows = true;

    const kotaCmd = api.commands.get("kota");
    await kotaCmd.handler("status", ctx);

    const notifyArgs = ctx.ui.notify.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(notifyArgs).toContain("mcp tools: (unknown/unavailable)");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("/kota evict-blobs calls evictBlobs with config", async () => {
    resetBehavior();
    evictSpy.mockClear();

    setConfig({
      ...getConfig(),
      blobs: {
        enabled: true,
        dir: "/tmp/blobs",
        maxAgeDays: 7,
        maxSizeBytes: 1234,
      },
    });

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const kotaCmd = api.commands.get("kota");
    await kotaCmd.handler("evict-blobs", ctx);

    expect(evictSpy).toHaveBeenCalledWith({ dir: "/tmp/blobs", maxAgeDays: 7, maxSizeBytes: 1234 });

    const notifyArgs = ctx.ui.notify.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(notifyArgs).toContain("Evicted");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("/kota evict-blobs is a no-op when blobs are disabled", async () => {
    resetBehavior();
    evictSpy.mockClear();

    setConfig({
      ...getConfig(),
      blobs: { ...getConfig().blobs, enabled: false },
    });

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const kotaCmd = api.commands.get("kota");
    await kotaCmd.handler("evict-blobs", ctx);

    expect(evictSpy).not.toHaveBeenCalled();

    const notifyArgs = ctx.ui.notify.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(notifyArgs).toContain("Blob cache is disabled");

    await api.fire("session_shutdown", {}, ctx);
  });

  it("/kota evict-blobs reports errors but does not throw", async () => {
    resetBehavior();
    evictSpy.mockClear();
    evictSpy.mockRejectedValueOnce(new Error("boom"));

    setConfig({
      ...getConfig(),
      blobs: {
        enabled: true,
        dir: "/tmp/blobs",
        maxAgeDays: 7,
        maxSizeBytes: 1234,
      },
    });

    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");
    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const kotaCmd = api.commands.get("kota");
    await kotaCmd.handler("evict-blobs", ctx);

    const notifyArgs = ctx.ui.notify.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(notifyArgs).toContain("Blob eviction failed");

    await api.fire("session_shutdown", {}, ctx);
  });
});
