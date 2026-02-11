import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { writeBlob } from "../src/blobs.js";

describe("writeBlob", () => {
  it("writes <sha256>.txt", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-"));
    const res = await writeBlob({ dir, content: "hello" });
    expect(res.blobId).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(res.blobPath, "utf8")).toBe("hello");
  });

  it("is deterministic under concurrent writes for identical content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-concurrent-"));
    const content = "deterministic blob content".repeat(1024);

    const writes = await Promise.all(
      Array.from({ length: 32 }, () => writeBlob({ dir, content })),
    );

    expect(new Set(writes.map((write) => write.blobId)).size).toBe(1);
    expect(new Set(writes.map((write) => write.blobPath)).size).toBe(1);

    const first = writes[0];
    expect(first.blobPath).toBe(path.join(dir, `${first.blobId}.txt`));
    expect(await readFile(first.blobPath, "utf8")).toBe(content);
  });

  it("writes unicode content correctly", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-unicode-"));
    const content = "こんにちは🌍\nПривет мир\nمرحبا بالعالم\nnaïve café";

    const res = await writeBlob({ dir, content });

    expect(await readFile(res.blobPath, "utf8")).toBe(content);
    expect(res.bytes).toBe(Buffer.byteLength(content, "utf8"));
  });
});

describe("writeBlob edge cases", () => {
  it("throws when parent directory is not writable", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-ro-"));
    const roDir = path.join(dir, "readonly");
    await mkdir(roDir, { mode: 0o444 });

    await expect(writeBlob({ dir: path.join(roDir, "nested"), content: "test" })).rejects.toThrow();
  });

  it("handles empty string content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-empty-"));
    const res = await writeBlob({ dir, content: "" });
    expect(res.blobId).toMatch(/^[a-f0-9]{64}$/);
    expect(res.bytes).toBe(0);
    expect(await readFile(res.blobPath, "utf8")).toBe("");
  });

  it("uses .json extension when specified", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-kota-blobs-ext-"));
    const res = await writeBlob({ dir, content: '{"a":1}', ext: ".json" });
    expect(res.blobPath).toMatch(/\.json$/);
  });
});
