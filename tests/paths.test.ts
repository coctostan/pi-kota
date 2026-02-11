import { describe, expect, it } from "vitest";
import { extractFilePaths } from "../src/paths.js";

describe("extractFilePaths", () => {
  it("extracts repo-like paths, deduped in order", () => {
    const text = "Touch src/index.ts, docs/design.md, and src/index.ts";
    expect(extractFilePaths(text)).toEqual(["src/index.ts", "docs/design.md"]);
  });

  it("extracts path at beginning of string", () => {
    expect(extractFilePaths("src/index.ts then more text")).toEqual(["src/index.ts"]);
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

describe("extractFilePaths edge cases", () => {
  it("returns empty for empty string", () => {
    expect(extractFilePaths("")).toEqual([]);
  });

  it("returns empty for string with no slash-separated tokens", () => {
    expect(extractFilePaths("hello world foo bar")).toEqual([]);
  });

  it("handles paths with dots in directory names", () => {
    expect(extractFilePaths("Open src/.hidden/config.ts")).toEqual(["src/.hidden/config.ts"]);
  });

  it("handles paths with hyphens and underscores", () => {
    expect(extractFilePaths("Check my-app/src_utils/helper-fn.ts")).toEqual([
      "my-app/src_utils/helper-fn.ts",
    ]);
  });

  it("ignores paths with .. (parent traversal)", () => {
    expect(extractFilePaths("Read ../sibling/file.ts")).toEqual([]);
  });

  it("handles multiple paths on same line", () => {
    expect(extractFilePaths("Diff src/a.ts against lib/b.ts")).toEqual(["src/a.ts", "lib/b.ts"]);
  });

  it("ignores directory-only paths (no file extension in last segment)", () => {
    expect(extractFilePaths("Look at src/utils/helpers")).toEqual([]);
  });
});
