import { describe, expect, it } from "vitest";
import { formatStatusLine, type StatusTheme } from "../src/status.js";

describe("formatStatusLine", () => {
  const noTheme: StatusTheme = {
    fg: (_style: string, text: string) => text,
  };

  it("shows stopped state", () => {
    const line = formatStatusLine(
      { kotaStatus: "stopped", repoRoot: "/home/user/my-repo", indexed: false, lastError: null },
      noTheme,
    );
    expect(line).toContain("stopped");
    expect(line).toContain("my-repo");
  });

  it("shows running + indexed state", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/home/user/my-repo", indexed: true, lastError: null },
      noTheme,
    );
    expect(line).toContain("running");
    expect(line).toContain("indexed");
  });

  it("shows running + not indexed state", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/home/user/my-repo", indexed: false, lastError: null },
      noTheme,
    );
    expect(line).toContain("running");
    expect(line).toContain("not indexed");
  });

  it("shows error state with message", () => {
    const line = formatStatusLine(
      { kotaStatus: "error", repoRoot: "/home/user/my-repo", indexed: false, lastError: "connect timeout" },
      noTheme,
    );
    expect(line).toContain("error");
    expect(line).toContain("connect timeout");
  });

  it("truncates long error messages to 40 chars and an ellipsis", () => {
    const longError = "1234567890123456789012345678901234567890EXTRA";
    const line = formatStatusLine(
      { kotaStatus: "error", repoRoot: "/home/user/my-repo", indexed: false, lastError: longError },
      noTheme,
    );
    expect(line).toContain("1234567890123456789012345678901234567890…");
    expect(line).not.toContain(longError);
  });

  it("shows starting state", () => {
    const line = formatStatusLine(
      { kotaStatus: "starting", repoRoot: null, indexed: false, lastError: null },
      noTheme,
    );
    expect(line).toContain("starting");
  });

  it("abbreviates long repo paths", () => {
    const line = formatStatusLine(
      { kotaStatus: "running", repoRoot: "/very/long/path/to/my-project", indexed: true, lastError: null },
      noTheme,
    );
    expect(line).toContain("my-project");
    expect(line).not.toContain("/very/long/path/to/");
  });
});
