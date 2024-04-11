// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CommandToken } from "./parser";
import { Shell } from "../utils/shell";
import { GlobalModel, getApi } from "@/models";
import { MemCache } from "@/util/memcache";

export type ExecuteShellCommandTTYResult = {
    code: number | null;
};

const commandResultCache = new MemCache<Fig.ExecuteCommandInput, Fig.ExecuteCommandOutput>(1000 * 60 * 5);

export const buildExecuteShellCommand =
    (timeout: number): Fig.ExecuteCommandFunction =>
    async (input: Fig.ExecuteCommandInput): Promise<Fig.ExecuteCommandOutput> => {
        const cachedResult = commandResultCache.get(input);
        if (cachedResult) {
            return cachedResult;
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
        commandResultCache.put(input, output);
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
