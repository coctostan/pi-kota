import { describe, expect, it, vi } from "vitest";

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
          autoContext: "off",
        },
        prune: { enabled: false, maxToolChars: 10, keepRecentTurns: 2, adaptive: false },
        blobs: { enabled: true, dir: "/tmp/pi-kota-test-blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
        log: { enabled: false, path: "/dev/null" },
      },
      sources: { global: "(mock)", project: "(mock)" },
    })),
  };
});

// Mock blob writing so tool_result truncation doesn't touch disk.
const { writeBlobSpy } = vi.hoisted(() => ({
  writeBlobSpy: vi.fn(async (_opts: any) => ({ blobId: "blob-1", blobPath: "/tmp/blob-1" })),
}));
vi.mock("../src/blobs.js", () => ({ writeBlob: writeBlobSpy }));

// Fully mock the MCP client so we never start a real kotadb process.
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
      this.connected = true;
    }
    isConnected() {
      return this.connected;
    }
    async listTools() {
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
      // Return deterministic text so callBudgeted has something to format.
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

import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

describe("index.ts coverage", () => {
  function makeCtx() {
    return {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
      },
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

  it("covers /kota subcommands and extra tools", async () => {
    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");

    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const kotaCmd = api.commands.get("kota");
    expect(kotaCmd).toBeTruthy();

    // status (no mcp yet)
    await kotaCmd.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalled();

    // reload-config
    await kotaCmd.handler("reload-config", ctx);

    // restart
    await kotaCmd.handler("restart", ctx);

    // unknown
    await kotaCmd.handler("wat", ctx);

    // index command path
    await kotaCmd.handler("index", ctx);

    // Exercise other tools for coverage.
    const deps = api.tools.get("kota_deps");
    const usages = api.tools.get("kota_usages");
    const impact = api.tools.get("kota_impact");
    const taskContext = api.tools.get("kota_task_context");

    await deps.execute("id", { file_path: "src/index.ts", depth: 1 }, undefined, undefined, ctx);
    await usages.execute("id", { symbol: "x", include_tests: false }, undefined, undefined, ctx);
    await impact.execute(
      "id",
      { change_type: "modify", description: "x" },
      undefined,
      undefined,
      ctx,
    );
    await taskContext.execute("id", { files: ["src/index.ts"] }, undefined, undefined, ctx);

    // status again (mcp tools should now be listed)
    await kotaCmd.handler("status", ctx);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("auto-loads config when tool is used before session_start", async () => {
    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");

    extension(api.pi as any);

    const ctx = makeCtx();

    const search = api.tools.get("kota_search");
    await search.execute("id", { query: "x", output: "paths", limit: 1 }, undefined, undefined, ctx);

    await api.fire("session_shutdown", {}, ctx);
  });

  it("truncates long tool_result output into blob reference", async () => {
    const api = createMockApi();
    installGitExecMocks(api, "HEAD-1");

    extension(api.pi as any);

    const ctx = makeCtx();
    await api.fire("session_start", {}, ctx);

    const longText = "x".repeat(200);
    const [res] = await api.fire(
      "tool_result",
      {
        toolName: "kota_search",
        content: [{ type: "text", text: longText }],
        details: {},
      },
      ctx,
    );

    expect(writeBlobSpy).toHaveBeenCalledTimes(1);
    expect(res.content[0].text).toContain("Output truncated");
    expect(res.details.truncated).toBe(true);
    expect(res.details.blobId).toBe("blob-1");

    await api.fire("session_shutdown", {}, ctx);
  });
});
