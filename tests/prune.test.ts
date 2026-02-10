import { describe, expect, it } from "vitest";
import { pruneContextMessages } from "../src/prune.js";

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
});
