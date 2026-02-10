const PATH_TOKEN_RE = /\b([A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-\.]+)+)\b/g;

function isRepoRelativePath(token: string): boolean {
  if (token.startsWith("/")) return false;
  if (token.startsWith("http://") || token.startsWith("https://")) return false;
  if (token.includes(":\\")) return false;
  if (token.includes("..")) return false;

  const last = token.split("/").at(-1) ?? "";
  if (!last.includes(".")) return false;
  return true;
}

export function extractFilePaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    const token = m[1];
    if (!token) continue;
    if (!isRepoRelativePath(token)) continue;
    if (seen.has(token)) continue;

    seen.add(token);
    out.push(token);
  }

  return out;
}
