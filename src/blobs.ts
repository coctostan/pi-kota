import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeBlob(opts: {
  dir: string;
  content: string;
  ext?: ".txt" | ".json";
}): Promise<{ blobId: string; blobPath: string; bytes: number }> {
  const ext = opts.ext ?? ".txt";
  const blobId = createHash("sha256").update(opts.content, "utf8").digest("hex");
  const blobPath = path.join(opts.dir, `${blobId}${ext}`);

  await mkdir(opts.dir, { recursive: true });
  await writeFile(blobPath, opts.content, "utf8");

  return { blobId, blobPath, bytes: Buffer.byteLength(opts.content, "utf8") };
}
