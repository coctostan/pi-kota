import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface EvictOptions {
  dir: string;
  maxAgeDays: number;
  maxSizeBytes: number;
}

export interface EvictResult {
  removedCount: number;
  removedBytes: number;
}

export async function evictBlobs(opts: EvictOptions): Promise<EvictResult> {
  let entries: string[];
  try {
    entries = await readdir(opts.dir);
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "ENOENT") {
      return { removedCount: 0, removedBytes: 0 };
    }
    throw e;
  }

  if (entries.length === 0) return { removedCount: 0, removedBytes: 0 };

  const now = Date.now();
  const maxAgeMs = opts.maxAgeDays * 86_400_000;

  type FileInfo = { fullPath: string; mtimeMs: number; size: number };
  const files: FileInfo[] = [];

  for (const name of entries) {
    const fullPath = path.join(opts.dir, name);
    try {
      const s = await stat(fullPath);
      if (s.isFile()) {
        files.push({ fullPath, mtimeMs: s.mtimeMs, size: s.size });
      }
    } catch {
      // skip unreadable entries
    }
  }

  let removedCount = 0;
  let removedBytes = 0;

  const survivors: FileInfo[] = [];
  for (const f of files) {
    if (now - f.mtimeMs > maxAgeMs) {
      try {
        await unlink(f.fullPath);
        removedCount++;
        removedBytes += f.size;
      } catch {
        survivors.push(f);
      }
    } else {
      survivors.push(f);
    }
  }

  survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let totalSize = survivors.reduce((sum, f) => sum + f.size, 0);

  for (const f of survivors) {
    if (totalSize <= opts.maxSizeBytes) break;
    try {
      await unlink(f.fullPath);
      removedCount++;
      removedBytes += f.size;
      totalSize -= f.size;
    } catch {
      // skip
    }
  }

  return { removedCount, removedBytes };
}
