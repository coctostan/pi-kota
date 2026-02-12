import path from "node:path";

export interface StatusInfo {
  kotaStatus: "stopped" | "starting" | "running" | "error";
  repoRoot: string | null;
  indexed: boolean;
  lastError: string | null;
}

export interface StatusTheme {
  fg(style: string, text: string): string;
}

function abbreviateRepo(repoRoot: string | null): string {
  if (!repoRoot) return "(no repo)";
  return path.basename(repoRoot);
}

export function formatStatusLine(info: StatusInfo, theme: StatusTheme): string {
  const repo = abbreviateRepo(info.repoRoot);

  const stateIcons: Record<StatusInfo["kotaStatus"], string> = {
    stopped: "○",
    starting: "◌",
    running: "●",
    error: "✖",
  };
  const stateColors: Record<StatusInfo["kotaStatus"], string> = {
    stopped: "dim",
    starting: "dim",
    running: "success",
    error: "error",
  };

  const icon = theme.fg(stateColors[info.kotaStatus], stateIcons[info.kotaStatus]);
  const state = theme.fg(stateColors[info.kotaStatus], info.kotaStatus);
  const repoText = theme.fg("dim", repo);

  const parts = [icon, state, theme.fg("dim", "|"), repoText];

  if (info.kotaStatus === "running") {
    const indexText = info.indexed
      ? theme.fg("success", "indexed")
      : theme.fg("warning", "not indexed");
    parts.push(theme.fg("dim", "|"), indexText);
  }

  if (info.kotaStatus === "error" && info.lastError) {
    const short = info.lastError.length > 40 ? info.lastError.slice(0, 40) + "…" : info.lastError;
    parts.push(theme.fg("dim", "|"), theme.fg("error", short));
  }

  return parts.join(" ");
}
