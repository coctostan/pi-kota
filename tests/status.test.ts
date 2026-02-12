import { describe, expect, it } from "vitest";
import { formatStatusLine } from "../src/status.js";

describe("formatStatusLine", () => {
  const noTheme = {
    fg: (_style: string, text: string) => text,
  };

  it("shows stopped state", () => {
    const line = formatStatusLine(
      { kotaStatus: "stopped", repoRoot: "/home/user/my-repo", indexed: false, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("stopped");
    expect(line).toContain("my-repo");
  });

  it("shows running + indexed state", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/home/user/my-repo", indexed: true, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("running");
    expect(line).toContain("indexed");
  });

  it("shows error state with message", () => {
    const line = formatStatusLine(
      { kotaStatus: "error", repoRoot: "/home/user/my-repo", indexed: false, lastError: "connect timeout" },
      noTheme as any,
    );
    expect(line).toContain("error");
    expect(line).toContain("connect timeout");
  });

  it("shows starting state", () => {
    const line = formatStatusLine(
      { kotaStatus: "starting", repoRoot: null, indexed: false, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("starting");
  });

  it("abbreviates long repo paths", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/very/long/path/to/my-project", indexed: true, lastError: null },
      noTheme as any,
    );
    expect(line).toContain("my-project");
    expect(line).not.toContain("/very/long/path/to/");
  });
});
