import path from "node:path";

import type { PiKotaConfig } from "./config.js";
import type { KotaMcpClient } from "./kota/mcp.js";

export interface RuntimeState {
  config: PiKotaConfig | null;
  configSources: { global?: string; project?: string } | null;

  repoRoot: string | null;
  indexedRepoRoot: string | null;

  kotaStatus: "stopped" | "starting" | "running" | "error";
  lastError: string | null;

  mcp: KotaMcpClient | null;
}

export function normalizeRepoPath(p: string): string {
  return path.normalize(path.resolve(p));
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    config: null,
    configSources: null,

    repoRoot: null,
    indexedRepoRoot: null,

    kotaStatus: "stopped",
    lastError: null,

    mcp: null,
  };
}
