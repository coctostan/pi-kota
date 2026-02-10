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
});
