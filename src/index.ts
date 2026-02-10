import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * pi-kota (stub)
 *
 * This repository currently contains the design/spec for the pi-kota extension.
 *
 * Implementation will:
 * - spawn/attach to `bunx kotadb@next --stdio --toolset core`
 * - implement minimal MCP JSON-RPC over stdio
 * - register pi tools: kota_search, kota_deps, kota_usages, kota_impact, kota_task_context
 * - implement context pruning (context event) + stored-output truncation (tool_result) with blob cache
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-kota", "pi-kota loaded (spec-only; implementation pending)");
    }
  });

  pi.registerCommand("kota", {
    description: "pi-kota commands (stub)",
    handler: async (args, ctx) => {
      const cmd = (args || "").trim();
      if (!ctx.hasUI) return;
      if (!cmd || cmd === "status") {
        ctx.ui.notify("pi-kota is not implemented yet (this repo currently contains the spec).", "info");
        return;
      }
      ctx.ui.notify(`Unknown /kota subcommand (stub): ${cmd}`, "warning");
    },
  });
}
