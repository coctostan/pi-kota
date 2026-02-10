import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AutoContextMode = "off" | "onPaths" | "always";

export interface PiKotaConfig {
  kota: {
    toolset: "core";
    autoContext: AutoContextMode;
    confirmIndex: boolean;
    command: string;
    args: string[];
  };
  prune: {
    enabled: boolean;
    keepRecentTurns: number;
    maxToolChars: number;
    adaptive: boolean;
  };
  blobs: {
    enabled: boolean;
    dir: string;
  };
}

export const DEFAULT_CONFIG: PiKotaConfig = {
  kota: {
    toolset: "core",
    autoContext: "off",
    confirmIndex: true,
    command: "bunx",
    args: ["kotadb@next", "--stdio", "--toolset", "core"],
  },
  prune: {
    enabled: true,
    keepRecentTurns: 2,
    maxToolChars: 1200,
    adaptive: true,
  },
  blobs: {
    enabled: true,
    dir: "~/.pi/cache/pi-kota/blobs",
  },
};

export function expandTilde(p: string, homeDir: string): string {
  if (p === "~") return homeDir;
  if (p.startsWith("~/")) return path.join(homeDir, p.slice(2));
  return p;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function mergeConfig(base: PiKotaConfig, override: DeepPartial<PiKotaConfig>): PiKotaConfig {
  const out: Record<string, unknown> = structuredClone(base) as unknown as Record<string, unknown>;

  const merge = (target: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v === undefined) continue;
      if (isObject(v) && isObject(target[k])) {
        merge(target[k] as Record<string, unknown>, v);
      } else {
        target[k] = v;
      }
    }
  };

  merge(out, override as Record<string, unknown>);
  return out as unknown as PiKotaConfig;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "ENOENT") {
      return undefined;
    }
    throw e;
  }
}

export async function loadConfig(opts?: {
  cwd?: string;
  projectRoot?: string;
  homeDir?: string;
}): Promise<{ config: PiKotaConfig; sources: { global?: string; project?: string } }> {
  const cwd = opts?.cwd ?? process.cwd();
  const homeDir = opts?.homeDir ?? os.homedir();

  const globalPath = path.join(homeDir, ".pi/agent/pi-kota.json");
  const projectPath = path.join(opts?.projectRoot ?? cwd, ".pi/pi-kota.json");

  const globalJson = await readJsonIfExists(globalPath);
  const projectJson = await readJsonIfExists(projectPath);

  let config = DEFAULT_CONFIG;
  const sources: { global?: string; project?: string } = {};

  if (globalJson) {
    config = mergeConfig(config, globalJson as DeepPartial<PiKotaConfig>);
    sources.global = globalPath;
  }

  if (projectJson) {
    config = mergeConfig(config, projectJson as DeepPartial<PiKotaConfig>);
    sources.project = projectPath;
  }

  config = {
    ...config,
    blobs: {
      ...config.blobs,
      dir: expandTilde(config.blobs.dir, homeDir),
    },
  };

  return { config, sources };
}
