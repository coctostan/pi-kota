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

function findOnPath(binaryName) {
  const pathValue = process.env.PATH ?? "";

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;

    const fullPath = path.join(dir, binaryName);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return fullPath;
    } catch {
      // continue
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

  process.stderr.write(
    [
      "\n⚠ pi-kota: 'bun' is not on PATH\n",
      `Found bunx at: ${bunxPath}`,
      `Resolves to: ${resolvedPath}\n`,
      "Add bun's directory to your PATH:",
      `  export PATH=\"${bunDir}:$PATH\"\n`,
      "Or create a bun symlink next to bunx:",
      `  ln -s ${resolvedPath} ${path.join(path.dirname(bunxPath), "bun")}\n`,
    ].join("\n"),
  );

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
