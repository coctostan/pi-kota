import { mkdtemp, readFile } from "node:fs/promises";
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
});
