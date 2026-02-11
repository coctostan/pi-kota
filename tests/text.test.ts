import { describe, expect, it } from "vitest";
import { truncateChars } from "../src/text.js";

describe("truncateChars", () => {
  it("returns empty string when maxChars <= 0", () => {
    expect(truncateChars("abcdef", 0)).toBe("");
    expect(truncateChars("abcdef", -1)).toBe("");
  });

  it("returns input when input length <= maxChars", () => {
    expect(truncateChars("abc", 3)).toBe("abc");
    expect(truncateChars("abc", 10)).toBe("abc");
  });

  it("returns ellipsis when maxChars === 1", () => {
    expect(truncateChars("abcdef", 1)).toBe("…");
  });

  it("truncates and adds ellipsis", () => {
    expect(truncateChars("abcdef", 4)).toBe("abc…");
  });
});
