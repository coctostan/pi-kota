function isToolResult(
  m: unknown,
): m is { role: "toolResult"; toolName: string; content: Array<{ type?: string; text?: string }>; details?: unknown } {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { role?: string }).role === "toolResult" &&
    typeof (m as { toolName?: unknown }).toolName === "string"
  );
}

function toolText(m: { content?: Array<{ type?: string; text?: string }> }): string {
  const block = Array.isArray(m.content) ? m.content.find((b) => b?.type === "text") : undefined;
  return typeof block?.text === "string" ? block.text : "";
}

export function computePruneSettings(
  base: { keepRecentTurns: number; maxToolChars: number },
  tokens: number | undefined,
): { keepRecentTurns: number; maxToolChars: number } {
  if (!tokens) return base;
  if (tokens < 120_000) return base;
  return {
    keepRecentTurns: Math.max(1, base.keepRecentTurns - 1),
    maxToolChars: Math.max(400, Math.floor(base.maxToolChars * 0.66)),
  };
}

export function pruneContextMessages(
  messages: unknown[],
  opts: {
    keepRecentTurns: number;
    maxToolChars: number;
    pruneToolNames: Set<string>;
  },
): unknown[] {
  const keepRecentTurns = Math.max(0, opts.keepRecentTurns);
  if (keepRecentTurns === 0) return messages;

  const userIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if ((messages[i] as { role?: string })?.role === "user") {
      userIndexes.push(i);
    }
  }

  const cutoff = userIndexes.length > keepRecentTurns ? userIndexes[userIndexes.length - keepRecentTurns] : 0;

  return messages.map((m, idx) => {
    if (idx >= cutoff) return m;
    if (!isToolResult(m)) return m;
    if (!opts.pruneToolNames.has(m.toolName)) return m;

    const text = toolText(m);
    if (text.length <= opts.maxToolChars) return m;

    return {
      ...m,
      content: [
        {
          type: "text",
          text:
            `(Pruned) ${m.toolName} tool output (${text.length} chars). ` +
            "Rehydrate by re-running the tool with narrower parameters.",
        },
      ],
      details: {
        ...(typeof m.details === "object" && m.details !== null ? m.details : {}),
        pruned: true,
        originalChars: text.length,
      },
    };
  });
}
