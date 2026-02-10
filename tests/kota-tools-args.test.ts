import { describe, expect, it } from "vitest";
import { prepareMcpArgs } from "../src/kota/tools.js";

describe("prepareMcpArgs", () => {
  it("maps index.path to index_repository repository + localPath", () => {
    expect(prepareMcpArgs("index", { path: "/repo" })).toEqual({
      repository: "/repo",
      localPath: "/repo",
    });
  });
});
