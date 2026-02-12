import { readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evictBlobs } from "../src/blobs-evict.js";

async function seedBlob(dir: string, name: string, ageMs: number): Promise<string> {
  const p = path.join(dir, name);
  await writeFile(p, "x".repeat(1024), "utf8");
  const pastDate = new Date(Date.now() - ageMs);
  await utimes(p, pastDate, pastDate);
  return p;
}

describe("evictBlobs", () => {
  it("removes files older than maxAgeDays", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-evict-")),
    );
    await seedBlob(dir, "old.txt", 8 * 86_400_000);
    await seedBlob(dir, "new.txt", 1 * 86_400_000);

    const result = await evictBlobs({ dir, maxAgeDays: 7, maxSizeBytes: Infinity });

    const remaining = await readdir(dir);
    expect(remaining).toEqual(["new.txt"]);
    expect(result.removedCount).toBe(1);
  });

  it("removes oldest files when total size exceeds maxSizeBytes", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-evict-size-")),
    );
    await seedBlob(dir, "oldest.txt", 3 * 86_400_000);
    await seedBlob(dir, "middle.txt", 2 * 86_400_000);
    await seedBlob(dir, "newest.txt", 1 * 86_400_000);

    const result = await evictBlobs({ dir, maxAgeDays: 30, maxSizeBytes: 2048 });

    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["middle.txt", "newest.txt"]);
    expect(result.removedCount).toBe(1);
  });

  it("is a no-op when directory does not exist", async () => {
    const result = await evictBlobs({
      dir: "/tmp/pi-kota-nonexistent-" + Date.now(),
      maxAgeDays: 7,
      maxSizeBytes: Infinity,
    });
    expect(result.removedCount).toBe(0);
  });

  it("is a no-op when directory is empty", async () => {
    const dir = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-evict-empty-")),
    );
    const result = await evictBlobs({ dir, maxAgeDays: 7, maxSizeBytes: Infinity });
    expect(result.removedCount).toBe(0);
  });
});
