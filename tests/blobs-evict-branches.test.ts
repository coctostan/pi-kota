import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => {
  return {
    readdir: vi.fn<[], any>(),
    stat: vi.fn<[string], any>(),
    unlink: vi.fn<[string], any>(),
  };
});

vi.mock("node:fs/promises", () => fsMocks);

describe("evictBlobs (error branches)", () => {
  beforeEach(() => {
    vi.resetModules();
    fsMocks.readdir.mockReset();
    fsMocks.stat.mockReset();
    fsMocks.unlink.mockReset();
  });

  it("throws for non-ENOENT readdir errors", async () => {
    fsMocks.readdir.mockRejectedValueOnce(Object.assign(new Error("no access"), { code: "EACCES" }));

    const { evictBlobs } = await import("../src/blobs-evict.js");

    await expect(evictBlobs({ dir: "/x", maxAgeDays: 7, maxSizeBytes: 1 })).rejects.toThrow(/no access/);
  });

  it("skips entries that fail stat()", async () => {
    fsMocks.readdir.mockResolvedValueOnce(["a.txt"]);
    fsMocks.stat.mockRejectedValueOnce(new Error("stat failed"));

    const { evictBlobs } = await import("../src/blobs-evict.js");

    await expect(evictBlobs({ dir: "/x", maxAgeDays: 7, maxSizeBytes: 1 })).resolves.toEqual({
      removedCount: 0,
      removedBytes: 0,
    });
  });

});
