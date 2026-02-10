import { describe, expect, it } from "vitest";
import { extractFilePaths } from "../src/paths.js";

describe("extractFilePaths", () => {
  it("extracts repo-like paths, deduped in order", () => {
    const text = "Touch src/index.ts, docs/design.md, and src/index.ts";
    expect(extractFilePaths(text)).toEqual(["src/index.ts", "docs/design.md"]);
  });

  it("ignores absolute paths and urls", () => {
    const text = "See https://example.com and /etc/passwd";
    expect(extractFilePaths(text)).toEqual([]);
  });
});
