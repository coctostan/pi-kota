import { describe, expect, it, vi } from "vitest";

// Mock config to enable blobs to prove we still don't evict at startup.
vi.mock("../src/config.js", () => {
  return {
    loadConfig: vi.fn(async () => ({
      config: {
        kota: { command: "kota", args: [], connectTimeoutMs: 10_000, confirmIndex: false, autoContext: { enabled: false } },
        prune: { enabled: false, maxToolChars: 50, keepRecentTurns: 2, adaptive: false },
        blobs: { enabled: true, dir: "/tmp/blobs", maxAgeDays: 30, maxSizeBytes: 1024 * 1024 },
        log: { enabled: false },
      },
      sources: { global: "(mock)", project: "(mock)" },
    }))
  };
});

const { evictSpy } = vi.hoisted(() => ({ evictSpy: vi.fn(async () => {}) }));
vi.mock("../src/blobs-evict.js", () => ({ evictBlobs: evictSpy }));

import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

describe("index.ts session_start", () => {
  it("does not evict blobs on session_start", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    const ctx: any = {
      cwd: process.cwd(),
      hasUI: true,
      ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn(async () => true) },
    };

    await api.fire("session_start", {}, ctx);

    expect(evictSpy).not.toHaveBeenCalled();
  });
});
