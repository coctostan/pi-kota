import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

// Mock config to avoid reading real disk config.
vi.mock("../src/config.js", () => {
  return {
    loadConfig: vi.fn(async () => ({
      config: {
        kota: {
          command: "kota",
          args: [],
          connectTimeoutMs: 10_000,
          confirmIndex: false,
          autoContext: "always",
        },
        prune: { enabled: false, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
        blobs: { enabled: false, dir: "/tmp/blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
        log: { enabled: false, path: "/dev/null" },
      },
      sources: { global: "(mock)", project: "(mock)" },
    }))
  };
});

// Fully mock the MCP client so we never start a real kotadb process.
let indexCalls = 0;
let releaseIndexBarrier: (() => void) | undefined;

let connectBarrierEnabled = false;
let releaseConnectBarrier: (() => void) | undefined;

let taskContextTransportError = false;

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
    async connect() {
      if (connectBarrierEnabled) {
        const barrier = new Promise<void>((resolve) => {
          releaseConnectBarrier = () => resolve();
        });
        await barrier;
      }
      this.connected = true;
    }
    isConnected() {
      return this.connected;
    }
    async listTools() {
      return ["index_repository", "search", "generate_task_context"];
    }
    async callTool(name: string, _args: any) {
      if (name === "index_repository") {
        indexCalls++;
        const barrier = new Promise<void>((resolve) => {
          releaseIndexBarrier = () => resolve();
        });
        await barrier;
        return { content: [{ type: "text", text: "indexed" }], raw: { ok: true } };
      }
      if (name === "search") {
        return { content: [{ type: "text", text: "ok" }], raw: { ok: true } };
      }
      if (name === "generate_task_context") {
        if (taskContextTransportError) {
          throw new Error("not connected");
        }
        return { content: [{ type: "text", text: "context ok" }], raw: { ok: true } };
      }
      return { content: [{ type: "text", text: "unknown" }], raw: {} };
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

// Wait for the index barrier to be armed (async call chain needs several microticks).
async function waitForBarrier(timeoutMs = 500) {
  const start = Date.now();
  while (!releaseIndexBarrier) {
    if (Date.now() - start > timeoutMs) throw new Error("index barrier not armed");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function waitForConnectBarrier(timeoutMs = 500) {
  const start = Date.now();
  while (!releaseConnectBarrier) {
    if (Date.now() - start > timeoutMs) throw new Error("connect barrier not armed");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("index.ts staleness + indexing", () => {
  it("warns at most once per HEAD when index is stale", async () => {
    indexCalls = 0;
    releaseIndexBarrier = undefined;

    const api = createMockApi();

    // Control git HEAD responses.
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: (api as any).__head + "\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });
    (api as any).__head = "HEAD-1";

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    // Mark repo as indexed by calling kota_index (will call index_repository once).
    const kotaIndex = api.tools.get("kota_index");

    // Release the index barrier so indexing can finish.
    const pIndex = kotaIndex.execute("id", {}, undefined, undefined, ctx);
    await waitForBarrier();
    releaseIndexBarrier!();
    await pIndex;

    // Now HEAD changes; first use should warn.
    (api as any).__head = "HEAD-2";
    const search = api.tools.get("kota_search");
    await search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

    // Second use with same HEAD should NOT warn again.
    await search.execute("id", { query: "y", output: "paths", limit: 1 }, undefined, undefined, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("/kota index forces a re-index when HEAD changed", async () => {
    indexCalls = 0;
    releaseIndexBarrier = undefined;

    const api = createMockApi();

    // Control git HEAD responses.
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: (api as any).__head + "\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });
    (api as any).__head = "HEAD-1";

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    // Index once via tool.
    const kotaIndex = api.tools.get("kota_index");
    const pIndex = kotaIndex.execute("id", {}, undefined, undefined, ctx);
    await waitForBarrier();
    releaseIndexBarrier!();
    await pIndex;
    expect(indexCalls).toBe(1);

    // Make index stale.
    (api as any).__head = "HEAD-2";

    // /kota index should trigger a second indexing run.
    releaseIndexBarrier = undefined;
    const kotaCmd = api.commands.get("kota");
    const pReindex = kotaCmd.handler("index", ctx);
    await waitForBarrier();
    releaseIndexBarrier!();
    await pReindex;

    expect(indexCalls).toBe(2);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("dedupes concurrent indexing from multiple tool calls", async () => {
    indexCalls = 0;
    releaseIndexBarrier = undefined;

    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: "HEAD-1\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    const search = api.tools.get("kota_search");

    const p1 = search.execute("id", { query: "a", output: "paths", limit: 1 }, undefined, undefined, ctx);
    const p2 = search.execute("id", { query: "b", output: "paths", limit: 1 }, undefined, undefined, ctx);

    await waitForBarrier();
    releaseIndexBarrier!();

    await Promise.all([p1, p2]);

    expect(indexCalls).toBe(1);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("dedupes concurrent indexing between kota_index and other tool calls", async () => {
    indexCalls = 0;
    releaseIndexBarrier = undefined;

    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: "HEAD-1\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    const kotaIndex = api.tools.get("kota_index");
    const search = api.tools.get("kota_search");

    const pIndex = kotaIndex.execute("id", {}, undefined, undefined, ctx);
    // Let kota_index enter ensureIndexed and set indexPromise.
    await Promise.resolve();

    const pSearch = search.execute("id", { query: "a", output: "paths", limit: 1 }, undefined, undefined, ctx);

    await waitForBarrier();
    releaseIndexBarrier!();

    await Promise.all([pIndex, pSearch]);

    expect(indexCalls).toBe(1);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("shows starting status while connecting", async () => {
    indexCalls = 0;
    releaseIndexBarrier = undefined;
    connectBarrierEnabled = true;
    releaseConnectBarrier = undefined;

    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: "HEAD-1\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    // Trigger a connection attempt via before_agent_start.
    const p = api.fire("before_agent_start", { prompt: "check src/index.ts" }, ctx);

    await waitForConnectBarrier();

    const statusSoFar = ctx.ui.setStatus.mock.calls.map((c: any[]) => String(c[1])).join("\n");
    expect(statusSoFar).toContain("starting");

    releaseConnectBarrier!();
    await p;

    connectBarrierEnabled = false;
    releaseConnectBarrier = undefined;

    await api.fire("session_shutdown", {}, ctx);
  });

  it("does not crash when ui.theme is present but missing fg()", async () => {
    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        theme: {},
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await expect(api.fire("session_start", {}, ctx)).resolves.toBeTruthy();

    await api.fire("session_shutdown", {}, ctx);
  });

  it("does not update status when only the MCP connection toggles", async () => {
    taskContextTransportError = false;

    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    // First call succeeds to establish a connection.
    await api.fire("before_agent_start", { prompt: "check src/index.ts" }, ctx);

    const callsBefore = ctx.ui.setStatus.mock.calls.length;

    // Now simulate a transport error: callBudgeted will disconnect the MCP client.
    taskContextTransportError = true;
    await api.fire("before_agent_start", { prompt: "check src/index.ts" }, ctx);

    expect(ctx.ui.setStatus.mock.calls.length).toBe(callsBefore);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("updates status to indexed after indexing completes", async () => {
    indexCalls = 0;
    releaseIndexBarrier = undefined;

    const api = createMockApi();
    api.pi.exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
        return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      }
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
        return { code: 0, stdout: "HEAD-1\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    });

    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
    };

    await api.fire("session_start", {}, ctx);

    const search = api.tools.get("kota_search");
    const pSearch = search.execute("id", { query: "a", output: "paths", limit: 1 }, undefined, undefined, ctx);

    await waitForBarrier();
    releaseIndexBarrier!();
    await pSearch;

    const lastStatus = String(ctx.ui.setStatus.mock.calls.at(-1)?.[1] ?? "");
    expect(lastStatus).toContain("indexed");
    expect(lastStatus).not.toContain("not indexed");

    await api.fire("session_shutdown", {}, ctx);
  });
});
