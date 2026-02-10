import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function toTextContent(content: unknown[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const textBlocks = content.filter((b): b is { type: "text"; text: string } => {
    return typeof b === "object" && b !== null && (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string";
  });
  return textBlocks.map((b) => b.text).join("\n");
}

const BUN_NOT_FOUND_MESSAGE = "pi-kota: 'bun' not found on PATH. Install bun (https://bun.sh) or check your PATH.";
const STDERR_BUFFER_CAP = 16 * 1024;

function isSpawnEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function hasBunMissingInStderr(stderr: string): boolean {
  const value = stderr.toLowerCase();
  return /env:\s*bun/.test(value) || /bun:\s*not found/.test(value) || (value.includes("bun") && value.includes("no such file or directory"));
}

function toStderrSnippet(stderr: string): string {
  return stderr.replace(/\s+/g, " ").trim();
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

    let stderrText = "";
    const onStderrData = (chunk: string | Buffer): void => {
      stderrText += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (stderrText.length > STDERR_BUFFER_CAP) {
        stderrText = stderrText.slice(-STDERR_BUFFER_CAP);
      }
    };

    const stderrStream = transport.stderr;
    stderrStream?.on("data", onStderrData);

    const client = new Client({ name: "pi-kota", version: "0.0.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      this.client = client;
    } catch (error) {
      const stderrSnippet = toStderrSnippet(stderrText);
      if ((this.stdio.command === "bun" && isSpawnEnoent(error)) || hasBunMissingInStderr(stderrText)) {
        throw new Error(BUN_NOT_FOUND_MESSAGE);
      }
      if (stderrSnippet) {
        throw new Error(`pi-kota: KotaDB subprocess failed — ${stderrSnippet}`);
      }
      throw error;
    } finally {
      stderrStream?.removeListener("data", onStderrData);
    }
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
