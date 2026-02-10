import type { PiKotaConfig } from "./config.js";
import type { KotaMcpClient } from "./kota/mcp.js";

export interface RuntimeState {
  config: PiKotaConfig | null;
  configSources: { global?: string; project?: string } | null;

  repoRoot: string | null;
  indexed: boolean;

  kotaStatus: "stopped" | "starting" | "running" | "error";
  lastError: string | null;

  mcp: KotaMcpClient | null;
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    config: null,
    configSources: null,

    repoRoot: null,
    indexed: false,

    kotaStatus: "stopped",
    lastError: null,

    mcp: null,
  };
}
