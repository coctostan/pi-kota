import { describe, expect, it } from "vitest";
import { computePruneSettings, pruneContextMessages } from "../src/prune.js";

const user = (t: string) => ({ role: "user", content: [{ type: "text", text: t }], timestamp: 1 });
const tool = (name: string, text: string) => ({
  role: "toolResult",
  toolName: name,
  content: [{ type: "text", text }],
  details: {},
  timestamp: 1,
});

describe("pruneContextMessages", () => {
  it("replaces large old tool results with a placeholder", () => {
    const messages = [user("A"), tool("read", "x".repeat(5000)), user("B")];

    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });

    expect((pruned[1] as any).content[0].text).toContain("(Pruned)");
  });

  it("with keepRecentTurns=0, prunes all eligible tool results", () => {
    const messages = [user("A"), tool("read", "x".repeat(5000)), user("B")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 0,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });

    expect((pruned[1] as any).content[0].text).toContain("(Pruned)");
  });

  it("does not crash on tool results with empty content array", () => {
    const messages = [
      user("A"),
      { role: "toolResult", toolName: "read", content: [], details: {}, timestamp: 1 },
      user("B"),
    ];

    expect(() =>
      pruneContextMessages(messages as any, {
        keepRecentTurns: 1,
        maxToolChars: 100,
        pruneToolNames: new Set(["read"]),
      }),
    ).not.toThrow();

    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });

    expect((pruned[1] as any).content).toEqual([]);
  });

  it("does not prune when tool text is already under budget", () => {
    const messages = [user("A"), tool("read", "short output"), user("B")];

    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });

    expect((pruned[1] as any).content[0].text).toBe("short output");
    expect((pruned[1] as any).details?.pruned).toBeUndefined();
  });
});

describe("pruneContextMessages edge cases", () => {
  it("returns empty array for empty messages", () => {
    const pruned = pruneContextMessages([], {
      keepRecentTurns: 2,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect(pruned).toEqual([]);
  });

  it("handles all-user messages (no tool results)", () => {
    const messages = [user("A"), user("B"), user("C")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect(pruned).toEqual(messages);
  });

  it("handles single turn (one user message)", () => {
    const messages = [user("A")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect(pruned).toEqual(messages);
  });

  it("does not prune tool results for non-matching tool names", () => {
    const messages = [user("A"), tool("bash", "x".repeat(5000)), user("B")];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect((pruned[1] as any).content[0].text).toBe("x".repeat(5000));
  });

  it("handles messages with missing text blocks in content", () => {
    const messages = [
      user("A"),
      { role: "toolResult", toolName: "read", content: [{ type: "image", data: "..." }], details: {} },
      user("B"),
    ];
    const pruned = pruneContextMessages(messages as any, {
      keepRecentTurns: 1,
      maxToolChars: 100,
      pruneToolNames: new Set(["read"]),
    });
    expect((pruned[1] as any).content[0].type).toBe("image");
  });
});

describe("computePruneSettings", () => {
  it("returns base settings below 120k tokens", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 1200 };
    expect(computePruneSettings(base, 100_000)).toEqual(base);
    expect(computePruneSettings(base, 119_999)).toEqual(base);
  });

  it("tightens at exactly 120k tokens", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 1200 };
    const result = computePruneSettings(base, 120_000);
    expect(result.keepRecentTurns).toBe(1);
    expect(result.maxToolChars).toBe(792);
  });

  it("returns base when tokens is undefined", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 1200 };
    expect(computePruneSettings(base, undefined)).toEqual(base);
  });

  it("clamps keepRecentTurns to minimum 1", () => {
    const base = { keepRecentTurns: 1, maxToolChars: 1200 };
    const result = computePruneSettings(base, 200_000);
    expect(result.keepRecentTurns).toBe(1);
  });

  it("clamps maxToolChars to minimum 400", () => {
    const base = { keepRecentTurns: 2, maxToolChars: 500 };
    const result = computePruneSettings(base, 200_000);
    expect(result.maxToolChars).toBe(400);
  });
});
