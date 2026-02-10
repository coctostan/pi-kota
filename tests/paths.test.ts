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

  it("ignores windows paths mixed with repo-relative paths", () => {
    const text = "Read C:/Users/dev/pi-kota/src/index.ts and src/paths.ts";
    expect(extractFilePaths(text)).toEqual(["src/paths.ts"]);
  });

  it("extracts deeply nested repo-relative paths", () => {
    const text = "Open src/features/autocontext/rules/extract/pathMatcher.spec.ts";
    expect(extractFilePaths(text)).toEqual([
      "src/features/autocontext/rules/extract/pathMatcher.spec.ts",
    ]);
  });
});
