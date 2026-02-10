import type { AutoContextMode } from "./config.js";

export function shouldAutoInject(paths: string[], mode: AutoContextMode): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return paths.length >= 1 && paths.length <= 3;
}
