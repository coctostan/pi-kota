import { describe, expect, it, vi } from "vitest";
import { ensureIndexed } from "../src/kota/ensure.js";

describe("ensureIndexed", () => {
  it("calls index exactly once", async () => {
    const state = { indexed: false };
    const index = vi.fn(async () => {});

    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm: vi.fn(async () => true),
      index,
    });

    expect(index).toHaveBeenCalledTimes(1);
    expect(state.indexed).toBe(true);
  });

  it("throws when confirmation is required and declined", async () => {
    const state = { indexed: false };
    await expect(
      ensureIndexed({
        state,
        confirmIndex: true,
        confirm: vi.fn(async () => false),
        index: vi.fn(async () => {}),
      }),
    ).rejects.toThrow("Indexing cancelled by user");
  });
});
