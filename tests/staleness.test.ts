import { describe, expect, it } from "vitest";
import { isIndexStale } from "../src/staleness.js";

describe("isIndexStale", () => {
  it("returns false when indexedAtCommit matches currentHead", () => {
    expect(isIndexStale("abc123", "abc123")).toBe(false);
  });

  it("returns true when commits differ", () => {
    expect(isIndexStale("abc123", "def456")).toBe(true);
  });

  it("returns false when indexedAtCommit is null (never indexed)", () => {
    expect(isIndexStale(null, "abc123")).toBe(false);
  });

  it("returns false when currentHead is null (git error)", () => {
    expect(isIndexStale("abc123", null)).toBe(false);
  });
});
