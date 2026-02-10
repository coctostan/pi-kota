import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function toTextContent(content: unknown[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const textBlocks = content.filter((b): b is { type: "text"; text: string } => {
    return typeof b === "object" && b !== null && (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string";
  });
  return textBlocks.map((b) => b.text).join("\n");
}

export class KotaMcpClient {
  private client: Client | null = null;

  constructor(private readonly stdio: { command: string; args: string[]; cwd: string }) {}

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const transport = new StdioClientTransport({
      command: this.stdio.command,
      args: this.stdio.args,
      cwd: this.stdio.cwd,
      stderr: "pipe",
    });

    const client = new Client({ name: "pi-kota", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
  }

  async listTools(): Promise<string[]> {
    if (!this.client) throw new Error("MCP client not connected");
    const res = await this.client.listTools();
    return (res.tools ?? []).map((t) => String(t.name));
  }

  async callTool(name: string, args: unknown): Promise<{ content: unknown[]; raw: unknown }> {
    if (!this.client) throw new Error("MCP client not connected");
    const raw = await this.client.callTool({
      name,
      arguments:
        typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
    });
    return { content: (raw?.content as unknown[] | undefined) ?? [], raw };
  }
}
