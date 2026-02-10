import { describe, expect, it } from "vitest";
import { truncateChars } from "../src/text.js";

describe("truncateChars", () => {
  it("truncates and adds ellipsis", () => {
    expect(truncateChars("abcdef", 4)).toBe("abc…");
  });
});
