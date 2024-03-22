// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { spawn } from "node:child_process";
import fsAsync from "node:fs/promises";

import { CommandToken } from "./parser.js";
import { Shell } from "../utils/shell.js";
import log from "../utils/log.js";

export type ExecuteShellCommandTTYResult = {
  code: number | null;
};

export const buildExecuteShellCommand =
  (timeout: number): Fig.ExecuteCommandFunction =>
  async ({ command, env, args, cwd }: Fig.ExecuteCommandInput): Promise<Fig.ExecuteCommandOutput> => {
    const child = spawn(command, args, { cwd, env });
    setTimeout(() => child.kill("SIGKILL"), timeout);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", (err) => {
      log.debug({ msg: "shell command failed", e: err.message });
    });
    return new Promise((resolve) => {
      child.on("close", (code) => {
        resolve({
          status: code ?? 0,
          stderr,
          stdout,
        });
      });
    });
  };

export const resolveCwd = async (
  cmdToken: CommandToken | undefined,
  cwd: string,
  shell: Shell,
): Promise<{ cwd: string; pathy: boolean; complete: boolean }> => {
  if (cmdToken == null) return { cwd, pathy: false, complete: false };
  const { token } = cmdToken;
  const sep = shell == Shell.Bash ? "/" : path.sep;
  if (!token.includes(sep)) return { cwd, pathy: false, complete: false };
  const resolvedCwd = path.isAbsolute(token) ? token : path.join(cwd, token);
  try {
    await fsAsync.access(resolvedCwd, fsAsync.constants.R_OK);
    return { cwd: resolvedCwd, pathy: true, complete: token.endsWith(sep) };
  } catch {
    // fallback to the parent folder if possible
    const baselessCwd = resolvedCwd.substring(0, resolvedCwd.length - path.basename(resolvedCwd).length);
    try {
      await fsAsync.access(baselessCwd, fsAsync.constants.R_OK);
      return { cwd: baselessCwd, pathy: true, complete: token.endsWith(sep) };
    } catch {
      /*empty*/
    }
    return { cwd, pathy: false, complete: false };
  }
};
