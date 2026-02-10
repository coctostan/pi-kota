import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-kota-buncheck-"));
  tempDirs.push(dir);
  return dir;
}

async function makeExe(dir: string, name: string, content: string) {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("postinstall bun check", () => {
  it("warns when bun is missing but bunx exists via symlink", async () => {
    const tmp = await makeTempDir();
    const binDir = path.join(tmp, "bin");
    const bunHomeDir = path.join(tmp, "bun-home");

    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(bunHomeDir, { recursive: true });

    const bunPath = await makeExe(bunHomeDir, "bun", "#!/bin/sh\nexit 0\n");
    await fs.symlink(bunPath, path.join(binDir, "bunx"));

    const result = spawnSync(process.execPath, ["scripts/check-bun.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: binDir },
      encoding: "utf8",
    });

    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(output).toContain("pi-kota");
    expect(output).toContain("'bun' is not on PATH");
    expect(output).toContain("export PATH=");
  });

  it("is silent when bun is on PATH", async () => {
    const tmp = await makeTempDir();
    const binDir = path.join(tmp, "bin");
    await fs.mkdir(binDir, { recursive: true });

    await makeExe(binDir, "bun", "#!/bin/sh\nexit 0\n");

    const result = spawnSync(process.execPath, ["scripts/check-bun.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: binDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`.trim()).toBe("");
  });
});
