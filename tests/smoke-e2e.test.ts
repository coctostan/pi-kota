import { describe, expect, it } from "vitest";
import extension from "../src/index.js";
import { createMockApi } from "./helpers/mock-api.js";

describe("e2e smoke (wiring)", () => {
  it("registers all pi-kota tools and the /kota command", async () => {
    const api = createMockApi();
    extension(api.pi as any);

    expect([...api.tools.keys()].sort()).toEqual(
      [
        "kota_deps",
        "kota_impact",
        "kota_index",
        "kota_search",
        "kota_task_context",
        "kota_usages",
      ].sort(),
    );

    expect(api.commands.has("kota")).toBe(true);
  });
});
