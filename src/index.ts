import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { loadConfig } from "./config.js";
import { createInitialRuntimeState, normalizeRepoPath } from "./runtime.js";

import { KotaMcpClient } from "./kota/mcp.js";
import { callBudgeted } from "./kota/tools.js";
import { ensureIndexed } from "./kota/ensure.js";
import { isIndexStale } from "./staleness.js";
import { createLogger, type Logger } from "./logger.js";

import {
  kotaIndexSchema,
  kotaSearchSchema,
  kotaDepsSchema,
  kotaUsagesSchema,
  kotaImpactSchema,
  kotaTaskContextSchema,
} from "./kota/schemas.js";
import { extractFilePaths } from "./paths.js";
import { shouldAutoInject } from "./autocontext.js";
import { computePruneSettings, pruneContextMessages } from "./prune.js";
import { shouldTruncateToolResult } from "./toolResult.js";
import { writeBlob } from "./blobs.js";
import { evictBlobs } from "./blobs-evict.js";
import { truncateChars } from "./text.js";

async function detectRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  try {
    const res = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 3000 });
    if (res.code === 0) return res.stdout.trim();
  } catch {
    // ignore
  }
  return cwd;
}

async function getHeadCommit(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    const res = await pi.exec("git", ["rev-parse", "HEAD"], { cwd, timeout: 3000 });
    return res.code === 0 ? res.stdout.trim() : null;
  } catch {
    return null;
  }
}

export default function (pi: ExtensionAPI) {
  const state = createInitialRuntimeState();

  function makeSafeLogger(inner: Logger): Logger {
    return {
      async log(category: string, event: string, data?: Record<string, unknown>) {
        try {
          await inner.log(category, event, data);
        } catch {
          // best-effort
        }
      },
      async close() {
        try {
          await inner.close();
        } catch {
          // best-effort
        }
      },
    };
  }

  let logger: Logger = makeSafeLogger({ async log() {}, async close() {} });

  async function refreshConfig(ctx: { cwd: string }) {
    if (!state.repoRoot) {
      state.repoRoot = await detectRepoRoot(pi, ctx.cwd);
    }

    const res = await loadConfig({ cwd: ctx.cwd, projectRoot: state.repoRoot });
    state.config = res.config;
    state.configSources = res.sources;
  }

  async function ensureConnected(ctx: { cwd: string; hasUI?: boolean; ui?: any }): Promise<void> {
    if (!state.config) throw new Error("pi-kota: config not loaded");
    if (!state.repoRoot) state.repoRoot = await detectRepoRoot(pi, ctx.cwd);

    if (state.mcp?.isConnected()) {
      state.kotaStatus = "running";
      return;
    }

    state.kotaStatus = "starting";

    const client = new KotaMcpClient({
      command: state.config.kota.command,
      args: state.config.kota.args,
      cwd: state.repoRoot,
      connectTimeoutMs: state.config.kota.connectTimeoutMs,
    });

    try {
      await client.connect();
      state.mcp = client;
      state.kotaStatus = "running";
      state.lastError = null;

      await logger.log("mcp", "connected", { repo: state.repoRoot ?? "(unknown)" });

      if (ctx.hasUI) {
        ctx.ui.setStatus("pi-kota", `kota: running | repo: ${state.repoRoot}`);
      }
    } catch (e: unknown) {
      state.kotaStatus = "error";
      state.lastError = e instanceof Error ? e.message : String(e);
      state.mcp = null;

      await logger.log("mcp", "connect_error", { error: state.lastError });

      if (ctx.hasUI) {
        ctx.ui.setStatus("pi-kota", `kota: error (${state.lastError})`);
      }

      throw e;
    }
  }

  async function listToolsSafe(): Promise<string[]> {
    if (!state.mcp) return [];
    try {
      return await state.mcp.listTools();
    } catch {
      return [];
    }
  }

  async function callKotaTool(
    ctx: { cwd: string; hasUI?: boolean; ui?: any },
    toolName: string,
    args: unknown,
  ): Promise<{ text: string; raw: unknown; ok: boolean }> {
    await ensureConnected(ctx);
    if (!state.config || !state.mcp) throw new Error("pi-kota: not connected");

    const t0 = Date.now();
    await logger.log("tool", "call_start", { toolName });

    const release = state.inFlight.acquire();
    try {
      const res = await callBudgeted({
        toolName,
        args,
        maxChars: 5000,
        listTools: () => state.mcp!.listTools(),
        callTool: (n, a) => state.mcp!.callTool(n, a),
        onTransportError: () => state.mcp?.disconnect(),
      });

      await logger.log("tool", "call_end", {
        toolName,
        ok: res.ok,
        durationMs: Date.now() - t0,
      });

      return res;
    } finally {
      release();
    }
  }

  async function callKotaToolStrict(
    ctx: { cwd: string; hasUI?: boolean; ui?: any },
    toolName: string,
    args: unknown,
  ): Promise<{ text: string; raw: unknown }> {
    const res = await callKotaTool(ctx, toolName, args);
    if (!res.ok) throw new Error(res.text);
    return res;
  }

  async function checkStaleness(ctx: { cwd: string; hasUI?: boolean; ui?: any }): Promise<void> {
    if (!state.indexedAtCommit || !state.repoRoot) return;

    const head = await getHeadCommit(pi, state.repoRoot);
    if (!head) return;

    // Warn at most once per distinct HEAD value.
    if (state.stalenessWarnedForHead === head) return;

    if (!isIndexStale(state.indexedAtCommit, head)) return;

    await logger.log("index", "stale_detected", {
      indexedAtCommit: state.indexedAtCommit,
      head,
    });

    if (ctx.hasUI) {
      ctx.ui.notify(
        "pi-kota: repo HEAD has changed since last index. Run /kota index to update.",
        "warning",
      );
    }

    state.stalenessWarnedForHead = head;
  }

  async function ensureRepoIndexed(ctx: { cwd: string; hasUI?: boolean; ui?: any }): Promise<void> {
    if (!state.config) throw new Error("pi-kota: config not loaded");
    const targetPath = normalizeRepoPath(state.repoRoot ?? ctx.cwd);
    const wasAlreadyIndexed = state.indexedRepoRoot === targetPath;

    await ensureIndexed({
      state: {
        get indexed() {
          return state.indexedRepoRoot === targetPath;
        },
        set indexed(v: boolean) {
          state.indexedRepoRoot = v ? targetPath : null;
        },
        get indexPromise() {
          return state.indexPromise;
        },
        set indexPromise(p: Promise<void> | null) {
          state.indexPromise = p;
        },
      },
      confirmIndex: state.config.kota.confirmIndex,
      confirm: (t, m) => (ctx.hasUI ? ctx.ui.confirm(t, m) : Promise.resolve(true)),
      index: async () => {
        await callKotaToolStrict(ctx, "index", { path: targetPath });
        state.indexedAtCommit = await getHeadCommit(pi, state.repoRoot ?? ctx.cwd);
      },
    });

    if (wasAlreadyIndexed) {
      await checkStaleness(ctx);
    }
  }

  pi.on("session_start", async (_event, ctx: any) => {
    state.repoRoot = await detectRepoRoot(pi, ctx.cwd);
    await refreshConfig(ctx);

    logger = makeSafeLogger(
      await createLogger({
        enabled: state.config?.log.enabled ?? false,
        path: state.config?.log.path,
      }),
    );

    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-kota", `kota: stopped | repo: ${state.repoRoot}`);
    }
  });

  pi.on("before_agent_start", async (event: any, ctx: any) => {
    if (!state.config) await refreshConfig(ctx);
    if (!state.config) return;

    const paths = extractFilePaths(event.prompt);
    if (!shouldAutoInject(paths, state.config.kota.autoContext)) return;

    try {
      const res = await callKotaTool(ctx, "task_context", { files: paths });
      if (!res.ok) return;
      return {
        message: {
          customType: "pi-kota:autoContext",
          content: `[pi-kota auto context]\nFiles: ${paths.join(", ")}\n\n${res.text}`,
          display: true,
        },
      };
    } catch {
      return;
    }
  });

  (pi as any).on("context", async (event: any, ctx: any) => {
    if (!state.config) return;
    if (!state.config.prune.enabled) return;

    const usage = ctx.getContextUsage?.();
    const base = {
      keepRecentTurns: state.config.prune.keepRecentTurns,
      maxToolChars: state.config.prune.maxToolChars,
    };

    const effective = state.config.prune.adaptive ? computePruneSettings(base, usage?.tokens) : base;

    const pruned = pruneContextMessages(event.messages as unknown[], {
      keepRecentTurns: effective.keepRecentTurns,
      maxToolChars: effective.maxToolChars,
      pruneToolNames: new Set(["read", "bash", "kota_search"]),
    });

    return { messages: pruned };
  });

  pi.on("tool_result", async (event: any) => {
    if (!state.config) return;
    if (!state.config.blobs.enabled) return;
    if (!shouldTruncateToolResult(event.toolName)) return;

    const textBlock = (event.content ?? []).find((b: any) => b?.type === "text" && typeof b.text === "string");
    const text = textBlock?.text ?? "";

    if (text.length <= state.config.prune.maxToolChars) return;

    const blob = await writeBlob({ dir: state.config.blobs.dir, content: text });
    const excerpt = truncateChars(text, state.config.prune.maxToolChars);

    const replacement =
      `${excerpt}\n\n` +
      `[pi-kota] Output truncated. Full output saved to blob:\n` +
      `- blobId: ${blob.blobId}\n` +
      `- blobPath: ${blob.blobPath}`;

    return {
      content: [{ type: "text", text: replacement }],
      details: {
        ...(event.details ?? {}),
        truncated: true,
        blobId: blob.blobId,
        blobPath: blob.blobPath,
        originalChars: text.length,
      },
    };
  });

  pi.on("session_shutdown", async () => {
    await state.inFlight.drain(3000);
    await logger.close();
    await state.mcp?.close().catch(() => {});
    state.mcp = null;
  });

  pi.registerCommand("kota", {
    description: "pi-kota commands (status/index/evict-blobs/reload-config/restart)",
    handler: async (args, ctx: any) => {
      const cmd = (args || "").trim();
      if (!ctx.hasUI) return;

      if (!cmd || cmd === "status") {
        const tools = await listToolsSafe();
        const src = state.configSources;
        ctx.ui.notify(
          [
            "pi-kota status",
            `kota: ${state.kotaStatus}`,
            `repo: ${state.repoRoot ?? "(unknown)"}`,
            `indexed: ${
              state.repoRoot && state.indexedRepoRoot === normalizeRepoPath(state.repoRoot) ? "yes" : "no"
            }`,
            `config: global=${src?.global ?? "(none)"}, project=${src?.project ?? "(none)"}`,
            tools.length ? `mcp tools: ${tools.join(", ")}` : "mcp tools: (unknown/unavailable)",
            state.lastError ? `lastError: ${state.lastError}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          "info",
        );
        return;
      }

      if (cmd === "reload-config") {
        await refreshConfig(ctx);
        ctx.ui.notify("Reloaded pi-kota config.", "info");
        return;
      }

      if (cmd === "restart") {
        await state.mcp?.close().catch(() => {});
        state.mcp = null;
        state.kotaStatus = "stopped";
        state.indexedRepoRoot = null;
        state.indexedAtCommit = null;
        state.stalenessWarnedForHead = null;
        ctx.ui.notify("KotaDB connection reset. Next kota_* call will reconnect.", "info");
        return;
      }

      if (cmd === "index") {
        if (!state.config) throw new Error("pi-kota: config not loaded");
        await ensureConnected(ctx);

        const targetPath = normalizeRepoPath(state.repoRoot ?? ctx.cwd);
        let output = "";
        await ensureIndexed({
          state: {
            get indexed() {
              return state.indexedRepoRoot === targetPath;
            },
            set indexed(v: boolean) {
              state.indexedRepoRoot = v ? targetPath : null;
            },
            get indexPromise() {
              return state.indexPromise;
            },
            set indexPromise(p: Promise<void> | null) {
              state.indexPromise = p;
            },
          },
          confirmIndex: state.config.kota.confirmIndex,
          confirm: (t, m) => ctx.ui.confirm(t, m),
          index: async () => {
            const res = await callKotaToolStrict(ctx, "index", { path: targetPath });
            output = res.text;
            state.indexedAtCommit = await getHeadCommit(pi, state.repoRoot ?? ctx.cwd);
          },
        });

        ctx.ui.notify(output || "Index complete.", "info");
        return;
      }

      if (cmd === "evict-blobs") {
        if (!state.config) await refreshConfig(ctx);
        if (!state.config) throw new Error("pi-kota: config not loaded");

        if (!state.config.blobs.enabled) {
          ctx.ui.notify("Blob cache is disabled (config.blobs.enabled=false).", "info");
          return;
        }

        try {
          const res = await evictBlobs({
            dir: state.config.blobs.dir,
            maxAgeDays: state.config.blobs.maxAgeDays,
            maxSizeBytes: state.config.blobs.maxSizeBytes,
          });

          ctx.ui.notify(`Evicted ${res.removedCount} blobs (${res.removedBytes} bytes).`, "info");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`Blob eviction failed: ${msg}`, "warning");
        }
        return;
      }

      ctx.ui.notify(`Unknown /kota subcommand: ${cmd}`, "warning");
    },
  });

  pi.registerTool({
    name: "kota_index",
    label: "Kota: Index",
    description: "Ensure the current repository is indexed in KotaDB",
    parameters: kotaIndexSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx: any) => {
      if (!state.config) await refreshConfig(ctx);
      await ensureConnected(ctx);

      if (!state.config) throw new Error("pi-kota: config not loaded");

      const p = (params as { path?: string }).path ?? state.repoRoot ?? ctx.cwd;
      const targetPath = normalizeRepoPath(p, ctx.cwd);

      let output = "";
      await ensureIndexed({
        state: {
          get indexed() {
            return state.indexedRepoRoot === targetPath;
          },
          set indexed(v: boolean) {
            state.indexedRepoRoot = v ? targetPath : null;
          },
          get indexPromise() {
            return state.indexPromise;
          },
          set indexPromise(p: Promise<void> | null) {
            state.indexPromise = p;
          },
        },
        confirmIndex: false,
        confirm: async () => true,
        index: async () => {
          const res = await callKotaToolStrict(ctx, "index", { path: targetPath });
          output = res.text;
          state.indexedAtCommit = await getHeadCommit(pi, state.repoRoot ?? ctx.cwd);
        },
      });

      return {
        content: [{ type: "text", text: output || "Index complete." }],
        details: { indexed: true },
      };
    },
  });

  pi.registerTool({
    name: "kota_search",
    label: "Kota: Search",
    description: "Search code via KotaDB (bounded output)",
    parameters: kotaSearchSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx: any) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureRepoIndexed(ctx);

      const res = await callKotaToolStrict(ctx, "search", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: true } };
    },
  });

  pi.registerTool({
    name: "kota_deps",
    label: "Kota: Deps",
    description: "Dependency graph query via KotaDB (bounded output)",
    parameters: kotaDepsSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx: any) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureRepoIndexed(ctx);

      const res = await callKotaToolStrict(ctx, "deps", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: true } };
    },
  });

  pi.registerTool({
    name: "kota_usages",
    label: "Kota: Usages",
    description: "Symbol usages via KotaDB (bounded output)",
    parameters: kotaUsagesSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx: any) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureRepoIndexed(ctx);

      const res = await callKotaToolStrict(ctx, "usages", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: true } };
    },
  });

  pi.registerTool({
    name: "kota_impact",
    label: "Kota: Impact",
    description: "Impact analysis via KotaDB (bounded output)",
    parameters: kotaImpactSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx: any) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureRepoIndexed(ctx);

      const res = await callKotaToolStrict(ctx, "impact", params);
      return {
        content: [{ type: "text", text: res.text }],
        details: { truncatedToChars: 5000, pinned: true, ok: true },
      };
    },
  });

  pi.registerTool({
    name: "kota_task_context",
    label: "Kota: Task Context",
    description: "Summarize dependencies/impact for a small set of files (bounded output)",
    parameters: kotaTaskContextSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx: any) => {
      if (!state.config) await refreshConfig(ctx);
      if (!state.config) throw new Error("pi-kota: config not loaded");

      await ensureConnected(ctx);
      await ensureRepoIndexed(ctx);

      const res = await callKotaToolStrict(ctx, "task_context", params);
      return { content: [{ type: "text", text: res.text }], details: { truncatedToChars: 5000, ok: true } };
    },
  });
}
