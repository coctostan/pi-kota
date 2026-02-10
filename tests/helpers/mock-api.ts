import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { vi } from "vitest";

const execFileAsync = promisify(execFile);

export type Handler = (event: any, ctx: any) => any | Promise<any>;

export function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();

  const pi: any = {
    on(event: string, handler: Handler) {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    },

    registerTool(def: any) {
      tools.set(def.name, def);
    },

    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },

    exec: vi.fn(async (cmd: string, args: string[], opts: any) => {
      try {
        const res = await execFileAsync(cmd, args, {
          cwd: opts?.cwd,
          timeout: opts?.timeout,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { code: 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
      } catch (e: any) {
        return {
          code: typeof e?.code === "number" ? e.code : 1,
          stdout: e?.stdout ?? "",
          stderr: e?.stderr ?? (e?.message ?? String(e)),
        };
      }
    }),
  };

  function getHandler(event: string): Handler | undefined {
    const arr = handlers.get(event) ?? [];
    return arr[0];
  }

  async function fire(event: string, payload: any, ctx: any) {
    const arr = handlers.get(event) ?? [];
    const results = [];
    for (const h of arr) results.push(await h(payload, ctx));
    return results;
  }

  return { pi, handlers, tools, commands, getHandler, fire };
}
