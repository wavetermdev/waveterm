// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/utils.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandToken } from "./parser";
import { Shell } from "../utils/shell";
import { GlobalModel, getApi } from "@/models";
import { MemCache } from "@/util/memcache";
import log from "../utils/log";

export type ExecuteShellCommandTTYResult = {
    code: number | null;
};

const commandResultCache = new MemCache<Fig.ExecuteCommandInput, Fig.ExecuteCommandOutput>(1000 * 60 * 5);

export const buildExecuteShellCommand =
    (timeout: number): Fig.ExecuteCommandFunction =>
    async (input: Fig.ExecuteCommandInput): Promise<Fig.ExecuteCommandOutput> => {
        const cachedResult = commandResultCache.get(input);
        log.debug("cachedResult", cachedResult);
        if (cachedResult) {
            log.debug("Using cached result for", input);
            return cachedResult;
        }
        log.debug("Executing command", input);
        const { command, args, cwd, env } = input;
        const resp = await GlobalModel.submitEphemeralCommand(
            "eval",
            null,
            [[command, ...args].join(" ")],
            null,
            false,
            {
                expectsresponse: true,
                overridecwd: cwd,
                env: env,
                timeoutms: timeout,
            }
        );

        const { stdout, stderr } = await GlobalModel.getEphemeralCommandOutput(resp);
        const output: Fig.ExecuteCommandOutput = { stdout, stderr, status: stderr?.length > 1 ? 1 : 0 };
        if (output.status !== 0) {
            log.debug("Command failed, skipping caching", output);
        } else {
            commandResultCache.put(input, output);
        }
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

export const getCompletionSuggestions = async (
    cwd: string,
    tempType: "filepaths" | "folders"
): Promise<Fig.TemplateSuggestion[]> => {
    const comptype = tempType === "filepaths" ? "file" : "directory";
    if (comptype == null) return [];
    const crtn = await GlobalModel.submitCommand("_compfiledir", null, [], { comptype, cwd }, false, false);
    if (Array.isArray(crtn?.update?.data)) {
        if (crtn.update.data.length === 0) return [];
        const firstData = crtn.update.data[0];
        if (firstData.info?.infocomps) {
            return firstData.info.infocomps.map((comp: string) => ({
                name: comp,
                priority: comp.startsWith(".") ? 1 : 55,
                context: { templateType: tempType },
                type: comp.endsWith("/") ? "folder" : "file",
            }));
        } else {
            return [];
        }
    }
};
