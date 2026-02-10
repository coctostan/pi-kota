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
const TIMEOUT_CLOSE_WAIT_CAP_MS = 50;

function isSpawnEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

const BUN_TOKEN_PATTERN = /(^|[^a-z0-9_])bun([^a-z0-9_]|$)/;
const BUN_MISSING_STDERR_PATTERNS = [
  /(?:^|\s)(?:\/usr\/bin\/)?env:\s*['"`‘’]?bun['"`‘’]?:\s*no such file or directory(?:\s|$)/,
  /(?:^|\s)['"`‘’]?bun['"`‘’]?:\s*no such file or directory(?:\s|$)/,
  /(?:^|\s)['"`‘’]?bun['"`‘’]?:\s*not found(?:\s|$)/,
];

function hasBunMissingInStderr(stderr: string): boolean {
  return stderr.split(/\r?\n/).some((line) => {
    const normalizedLine = line.toLowerCase();
    return BUN_TOKEN_PATTERN.test(normalizedLine) && BUN_MISSING_STDERR_PATTERNS.some((pattern) => pattern.test(normalizedLine));
  });
}

function toStderrSnippet(stderr: string): string {
  return stderr.replace(/\s+/g, " ").trim();
}

export class KotaMcpClient {
  private client: Client | null = null;
  private readonly connectTimeoutMs: number;

  constructor(private readonly stdio: { command: string; args: string[]; cwd: string; connectTimeoutMs?: number }) {
    this.connectTimeoutMs = stdio.connectTimeoutMs ?? 10000;
  }

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

    const timeoutMs = this.connectTimeoutMs;
    const timeoutErrorMessage =
      `pi-kota: KotaDB failed to start within ${timeoutMs}ms. ` +
      "Check that 'bun' is installed and working. Run /kota restart to retry.";

    let didTimeout = false;
    const timeoutError = new Error(timeoutErrorMessage);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(async () => {
        didTimeout = true;
        const closeAttempt = transport.close().catch(() => {});
        await Promise.race([
          closeAttempt,
          new Promise<void>((resolve) => setTimeout(resolve, TIMEOUT_CLOSE_WAIT_CAP_MS)),
        ]);
        reject(timeoutError);
      }, timeoutMs);
    });

    try {
      await Promise.race([client.connect(transport), timeoutPromise]);
      this.client = client;
    } catch (error) {
      if (didTimeout || (error instanceof Error && error.message === timeoutErrorMessage)) {
        throw timeoutError;
      }

      const stderrSnippet = toStderrSnippet(stderrText);
      if ((this.stdio.command === "bun" && isSpawnEnoent(error)) || hasBunMissingInStderr(stderrText)) {
        throw new Error(BUN_NOT_FOUND_MESSAGE);
      }
      if (stderrSnippet) {
        throw new Error(`pi-kota: KotaDB subprocess failed — ${stderrSnippet}`);
      }
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
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
