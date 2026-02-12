import { describe, expect, it } from "vitest";
import { shouldAutoInject } from "../src/autocontext.js";
import { extractFilePaths } from "../src/paths.js";

describe("shouldAutoInject", () => {
  it("onPaths injects only for 1-3 paths", () => {
    expect(shouldAutoInject(["a/b.ts"], "onPaths")).toBe(true);
    expect(shouldAutoInject(["1", "2", "3", "4"], "onPaths")).toBe(false);
  });

  it("off never injects even with extracted paths", () => {
    expect(shouldAutoInject(["src/paths.ts", "docs/design.md"], "off")).toBe(false);
  });

  it("always injects even with zero extracted paths", () => {
    expect(shouldAutoInject([], "always")).toBe(true);
  });
});

describe("autoContext + extractFilePaths integration", () => {
  it("onPaths mode injects when prompt mentions 1-3 file paths", () => {
    const prompt = "Fix the bug in src/config.ts and src/index.ts";
    const paths = extractFilePaths(prompt);
    expect(paths).toEqual(["src/config.ts", "src/index.ts"]);
    expect(shouldAutoInject(paths, "onPaths")).toBe(true);
  });

  it("onPaths mode does not inject when prompt mentions 4+ file paths", () => {
    const prompt = "Update src/a.ts src/b.ts src/c.ts src/d.ts";
    const paths = extractFilePaths(prompt);
    expect(paths).toHaveLength(4);
    expect(shouldAutoInject(paths, "onPaths")).toBe(false);
  });

  it("onPaths mode does not inject for prompts without file paths", () => {
    const prompt = "What does the config loader do?";
    const paths = extractFilePaths(prompt);
    expect(paths).toEqual([]);
    expect(shouldAutoInject(paths, "onPaths")).toBe(false);
  });

  it("always mode injects even without file paths", () => {
    const prompt = "Summarize the architecture";
    const paths = extractFilePaths(prompt);
    expect(shouldAutoInject(paths, "always")).toBe(true);
  });
});
