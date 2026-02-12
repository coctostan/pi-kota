import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface Logger {
  log(category: string, event: string, data?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

const noopLogger: Logger = {
  async log() {},
  async close() {},
};

export async function createLogger(opts: { enabled: boolean; path?: string }): Promise<Logger> {
  if (!opts.enabled || !opts.path) return noopLogger;

  const logPath = opts.path;
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
  } catch {
    // If we can't create the directory, fall back to noop.
    return noopLogger;
  }

  return {
    async log(category: string, event: string, data?: Record<string, unknown>): Promise<void> {
      try {
        const entry = JSON.stringify({ ts: new Date().toISOString(), category, event, data }) + "\n";
        await appendFile(logPath, entry, "utf8");
      } catch {
        // best-effort: never throw
      }
    },
    async close(): Promise<void> {
      // no-op for append logger (but never throw)
    },
  };
}
