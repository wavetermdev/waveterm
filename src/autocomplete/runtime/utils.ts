// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CommandToken } from "./parser";
import { Shell } from "../utils/shell";
import { GlobalModel, getApi } from "@/models";

export type ExecuteShellCommandTTYResult = {
    code: number | null;
};

let lastCommandResult: { input: Fig.ExecuteCommandInput; output: Fig.ExecuteCommandOutput } = null;

const checkLastCommandResult = (input: Fig.ExecuteCommandInput): boolean => {
    if (lastCommandResult == null) return false;
    const { command, args, cwd, env } = input;
    const { command: lastCommand, args: lastArgs, cwd: lastCwd, env: lastEnv } = lastCommandResult.input;
    return command == lastCommand && args.join(" ") == lastArgs.join(" ") && cwd == lastCwd && env == lastEnv;
};

export const buildExecuteShellCommand =
    (timeout: number): Fig.ExecuteCommandFunction =>
    async (input: Fig.ExecuteCommandInput): Promise<Fig.ExecuteCommandOutput> => {
        if (checkLastCommandResult(input)) {
            return lastCommandResult.output;
        }
        const { command, args, cwd, env } = input;
        const resp = await GlobalModel.submitEphemeralCommand("eval", null, [command, ...args], null, false, {
            expectsresponse: true,
            overridecwd: cwd,
            env: env,
            timeoutms: timeout,
        });

        const { stdout, stderr } = await GlobalModel.getEphemeralCommandOutput(resp);
        const output: Fig.ExecuteCommandOutput = { stdout, stderr, status: stderr ? 1 : 0 };
        lastCommandResult = { input, output };
        return output;
    };

export const resolveCwd = async (
    cmdToken: CommandToken | undefined,
    cwd: string,
    shell: Shell
): Promise<{ cwd: string; pathy: boolean; complete: boolean }> => {
    if (cmdToken == null) return { cwd, pathy: false, complete: false };
    const { token } = cmdToken;
    const sep = shell == Shell.Bash ? "/" : getApi().pathSep();
    if (!token.includes(sep)) return { cwd, pathy: false, complete: false };
    return { cwd: cwd, pathy: true, complete: token.endsWith(sep) };
};
