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

describe("ensureIndexed edge cases", () => {
  it("propagates error when index() throws", async () => {
    const state = { indexed: false };
    await expect(
      ensureIndexed({
        state,
        confirmIndex: false,
        confirm: vi.fn(async () => true),
        index: vi.fn(async () => {
          throw new Error("MCP connection lost");
        }),
      }),
    ).rejects.toThrow("MCP connection lost");

    expect(state.indexed).toBe(false);
  });

  it("does not double-index on repeated calls", async () => {
    const state = { indexed: false };
    let indexCallCount = 0;
    const index = vi.fn(async () => {
      indexCallCount++;
      await new Promise((r) => setTimeout(r, 50));
    });

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

    expect(indexCallCount).toBe(1);
  });

  it("skips confirm when confirmIndex is false", async () => {
    const state = { indexed: false };
    const confirm = vi.fn(async () => true);
    const index = vi.fn(async () => {});

    await ensureIndexed({
      state,
      confirmIndex: false,
      confirm,
      index,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(index).toHaveBeenCalledTimes(1);
  });
});
