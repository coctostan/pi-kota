import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function tryExec(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(binaryName) {
  const candidates = [binaryName];

  // If the caller already provides an extension, don't add PATHEXT variants.
  if (path.extname(binaryName)) return candidates;

  const pathext = process.env.PATHEXT;
  if (!pathext) return candidates;

  const exts = pathext
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));

  for (const ext of exts) {
    const lower = ext.toLowerCase();
    const upper = ext.toUpperCase();
    candidates.push(`${binaryName}${ext}`);
    if (lower !== ext) candidates.push(`${binaryName}${lower}`);
    if (upper !== ext && upper !== lower) candidates.push(`${binaryName}${upper}`);
  }

  return [...new Set(candidates)];
}

function findOnPath(binaryName) {
  const pathValue = process.env.PATH ?? "";
  const candidates = pathCandidates(binaryName);

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;

    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return fullPath;
      } catch {
        // continue
      }
    }
  }

  return null;
}

if (tryExec("bun", ["--version"])) {
  process.exit(0);
}

const bunxPath = findOnPath("bunx");

if (bunxPath) {
  let resolvedPath = bunxPath;

  try {
    resolvedPath = fs.realpathSync(bunxPath);
  } catch {
    // keep bunxPath
  }

  const bunDir = path.dirname(resolvedPath);
  const canSuggestSymlink = path.basename(resolvedPath) === "bun" && resolvedPath !== bunxPath;
  const lines = [
    "\n⚠ pi-kota: 'bun' is not on PATH\n",
    `Found bunx at: ${bunxPath}`,
    `Resolves to: ${resolvedPath}\n`,
    "Add bun's directory to your PATH:",
    `  export PATH=\"${bunDir}:$PATH\"\n`,
  ];

  if (canSuggestSymlink) {
    lines.push("Or create a bun symlink next to bunx:");
    lines.push(`  ln -s ${resolvedPath} ${path.join(path.dirname(bunxPath), "bun")}\n`);
  } else {
    lines.push("Could not safely infer bun binary from bunx; skipping symlink advice.");
    lines.push("Install bun and ensure it is on PATH:");
    lines.push("  curl -fsSL https://bun.sh/install | bash\n");
  }

  process.stderr.write(lines.join("\n"));

  process.exit(0);
}

process.stderr.write(
  [
    "\n⚠ pi-kota: bun runtime not found\n",
    "Install bun:",
    "  curl -fsSL https://bun.sh/install | bash\n",
  ].join("\n"),
);

process.exit(0);
