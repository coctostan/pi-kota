import { describe, expect, it } from "vitest";
import { resolveMcpToolName } from "../src/kota/tools.js";

describe("resolveMcpToolName", () => {
  it("maps wrapper names to KotaDB MCP names", () => {
    expect(resolveMcpToolName("index")).toBe("index_repository");
    expect(resolveMcpToolName("deps")).toBe("search_dependencies");
    expect(resolveMcpToolName("usages")).toBe("find_usages");
    expect(resolveMcpToolName("impact")).toBe("analyze_change_impact");
    expect(resolveMcpToolName("task_context")).toBe("generate_task_context");
    expect(resolveMcpToolName("search")).toBe("search");
  });
});
