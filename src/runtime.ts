import path from "node:path";

import type { PiKotaConfig } from "./config.js";
import type { KotaMcpClient } from "./kota/mcp.js";

export class InFlightTracker {
  private _count = 0;
  private _waiters: Array<() => void> = [];

  get count(): number {
    return this._count;
  }

  acquire(): () => void {
    this._count++;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this._count = Math.max(0, this._count - 1);

      if (this._count === 0) {
        for (const waiter of this._waiters.splice(0)) waiter();
      }
    };
  }

  drain(timeoutMs: number): Promise<void> {
    if (this._count === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this._waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export interface RuntimeState {
  config: PiKotaConfig | null;
  configSources: { global?: string; project?: string } | null;

  repoRoot: string | null;
  indexedRepoRoot: string | null;
  indexedAtCommit: string | null;

  kotaStatus: "stopped" | "starting" | "running" | "error";
  lastError: string | null;

  mcp: KotaMcpClient | null;
  inFlight: InFlightTracker;
}

export function normalizeRepoPath(p: string, baseDir?: string): string {
  const absolute = baseDir ? path.resolve(baseDir, p) : path.resolve(p);
  return path.normalize(absolute);
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    config: null,
    configSources: null,

    repoRoot: null,
    indexedRepoRoot: null,
    indexedAtCommit: null,

    kotaStatus: "stopped",
    lastError: null,

    mcp: null,
    inFlight: new InFlightTracker(),
  };
}
