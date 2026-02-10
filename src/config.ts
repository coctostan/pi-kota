import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AutoContextMode = "off" | "onPaths" | "always";

export interface PiKotaConfig {
  kota: {
    toolset: "core";
    autoContext: AutoContextMode;
    confirmIndex: boolean;
    connectTimeoutMs: number;
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
    connectTimeoutMs: 10000,
    command: "bun",
    args: ["x", "kotadb@next", "--stdio", "--toolset", "core"],
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

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeNumber(value: unknown, fallback: number, min?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (min !== undefined && value < min) return fallback;
  return value;
}

function sanitizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.every((item) => typeof item === "string") ? value : fallback;
}

export function sanitizeConfig(config: unknown): PiKotaConfig {
  const root = isObject(config) ? config : {};
  const kota = isObject(root.kota) ? root.kota : {};
  const prune = isObject(root.prune) ? root.prune : {};
  const blobs = isObject(root.blobs) ? root.blobs : {};

  const autoContext =
    kota.autoContext === "off" || kota.autoContext === "onPaths" || kota.autoContext === "always"
      ? kota.autoContext
      : DEFAULT_CONFIG.kota.autoContext;

  const command = sanitizeString(kota.command, DEFAULT_CONFIG.kota.command);

  return {
    kota: {
      toolset: kota.toolset === "core" ? "core" : DEFAULT_CONFIG.kota.toolset,
      autoContext,
      confirmIndex: sanitizeBoolean(kota.confirmIndex, DEFAULT_CONFIG.kota.confirmIndex),
      connectTimeoutMs: sanitizeNumber(
        kota.connectTimeoutMs,
        DEFAULT_CONFIG.kota.connectTimeoutMs,
        1,
      ),
      command: command.length > 0 ? command : DEFAULT_CONFIG.kota.command,
      args: sanitizeStringArray(kota.args, DEFAULT_CONFIG.kota.args),
    },
    prune: {
      enabled: sanitizeBoolean(prune.enabled, DEFAULT_CONFIG.prune.enabled),
      keepRecentTurns: sanitizeNumber(prune.keepRecentTurns, DEFAULT_CONFIG.prune.keepRecentTurns, 0),
      maxToolChars: sanitizeNumber(prune.maxToolChars, DEFAULT_CONFIG.prune.maxToolChars, 1),
      adaptive: sanitizeBoolean(prune.adaptive, DEFAULT_CONFIG.prune.adaptive),
    },
    blobs: {
      enabled: sanitizeBoolean(blobs.enabled, DEFAULT_CONFIG.blobs.enabled),
      dir: sanitizeString(blobs.dir, DEFAULT_CONFIG.blobs.dir),
    },
  };
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

  const sanitized = sanitizeConfig(config);

  config = {
    ...sanitized,
    blobs: {
      ...sanitized.blobs,
      dir: expandTilde(sanitized.blobs.dir, homeDir),
    },
  };

  return { config, sources };
}
