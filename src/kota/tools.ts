import { truncateChars } from "../text.js";
import { toTextContent } from "./mcp.js";

const TOOL_NAME_MAP: Record<string, string> = {
  index: "index_repository",
  deps: "search_dependencies",
  usages: "find_usages",
  impact: "analyze_change_impact",
  task_context: "generate_task_context",
};

export function resolveMcpToolName(toolName: string): string {
  return TOOL_NAME_MAP[toolName] ?? toolName;
}

export function prepareMcpArgs(toolName: string, args: unknown): unknown {
  if (toolName === "index" && typeof args === "object" && args !== null) {
    const maybePath = (args as { path?: unknown }).path;
    if (typeof maybePath === "string" && maybePath.length > 0) {
      return { repository: maybePath, localPath: maybePath };
    }
  }
  return args;
}

export function formatToolError(toolName: string, availableTools: string[], err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const list = availableTools.length ? availableTools.join(", ") : "(none)";
  return [
    `kota: failed to call MCP tool \"${toolName}\"`,
    `error: ${message}`,
    `Available MCP tools: ${list}`,
    "Hint: ensure bun is installed and KotaDB starts with --toolset core.",
  ].join("\n");
}

export async function callBudgeted(opts: {
  toolName: string;
  args: unknown;
  maxChars: number;
  listTools: () => Promise<string[]>;
  callTool: (name: string, args: unknown) => Promise<{ content: unknown[]; raw: unknown }>;
}): Promise<{ text: string; raw: unknown; ok: boolean }> {
  const mcpToolName = resolveMcpToolName(opts.toolName);
  const mcpArgs = prepareMcpArgs(opts.toolName, opts.args);

  try {
    const { content, raw } = await opts.callTool(mcpToolName, mcpArgs);
    const text = toTextContent(content);
    const fallback = JSON.stringify(raw, null, 2);
    return {
      text: truncateChars(text || fallback, opts.maxChars),
      raw,
      ok: true,
    };
  } catch (e) {
    const available = await opts.listTools().catch(() => [] as string[]);
    return {
      text: truncateChars(formatToolError(opts.toolName, available, e), opts.maxChars),
      raw: null,
      ok: false,
    };
  }
}
