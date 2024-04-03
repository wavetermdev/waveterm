// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CommandToken } from "./parser";
import { Shell } from "../utils/shell";
import { GlobalModel, getApi } from "@/models";

export type ExecuteShellCommandTTYResult = {
    code: number | null;
};

const pathSep = getApi().pathSep();

export const buildExecuteShellCommand =
    (timeout: number): Fig.ExecuteCommandFunction =>
    async ({ command, env, args, cwd }: Fig.ExecuteCommandInput): Promise<Fig.ExecuteCommandOutput> => {
        const resp = await GlobalModel.submitEphemeralCommand("eval", null, [command, ...args], null, false, {
            expectsresponse: true,
            overridecwd: cwd,
            env: env,
            timeoutms: timeout,
        });
        console.log("resp", resp);

        const { stdout, stderr } = await GlobalModel.getEphemeralCommandOutput(resp);
        console.log("stdout", stdout);
        console.log("stderr", stderr);
        return { stdout, stderr, status: stderr ? 1 : 0 };
    };

export const resolveCwd = async (
    cmdToken: CommandToken | undefined,
    cwd: string,
    shell: Shell
): Promise<{ cwd: string; pathy: boolean; complete: boolean }> => {
    if (cmdToken == null) return { cwd, pathy: false, complete: false };
    const { token } = cmdToken;
    const sep = shell == Shell.Bash ? "/" : pathSep;
    return { cwd: cwd, pathy: true, complete: token.endsWith(sep) };
};
