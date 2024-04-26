// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/utils.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Shell } from "../utils/shell";
import { GlobalModel, getApi } from "@/models";
import { MemCache } from "@/util/memcache";
import log from "../utils/log";
import { Token, TokenType } from "./model";

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

const pathSeps = new Map<Shell, string>();

/**
 * Get the path separator for the given shell.
 * @param shell The shell to get the path separator for.
 * @returns The path separator.
 */
export function getPathSep(shell: Shell): string {
    if (!pathSeps.has(shell)) {
        const pathSep = getApi().pathSep();
        pathSeps.set(shell, pathSep);
        return pathSep;
    }
    return pathSeps.get(shell) as string;
}

/**
 * Determine if the current token is a path or not. If it is an incomplete path, return the base name of the path as the new cwd to be used in downstream parsing operations. Otherwise, return the current cwd.
 * @param token The token to check.
 * @param cwd The current working directory.
 * @param shell The shell being used.
 * @returns The new cwd, whether the token is a path, and whether the path is complete.
 */
export async function resolveCwdToken(
    token: Token,
    cwd: string,
    shell: Shell
): Promise<{ cwd: string; pathy: boolean; complete: boolean }> {
    log.debug("resolveCwdToken start", { token, cwd });
    if (token == null) return { cwd, pathy: false, complete: false };
    log.debug("resolveCwdToken token not null");
    if (token.type != TokenType.PATH) return { cwd, pathy: false, complete: false };
    const sep = getPathSep(shell);
    const complete = token.value.endsWith(sep);
    const dirname = getApi().pathDirName(token.value);
    log.debug("resolveCwdToken dirname", dirname);

    // This accounts for cases where the somewhat dumb path.dirname function parses a path out of a token that is not a path, like "git commit -m 'foo/bar'"
    if (dirname !== "." && !token.value.startsWith(dirname)) return { cwd, pathy: false, complete: false };

    let respCwd = await resolvePathRemote(complete ? token.value : dirname);
    const exists = respCwd !== undefined;
    respCwd = respCwd ? (respCwd?.endsWith(sep) ? respCwd : respCwd + sep) : cwd;
    log.debug("resolveCwdToken", { token, cwd, complete, dirname, respCwd, exists });
    return { cwd: respCwd, pathy: exists, complete: complete && exists };
}

/**
 * Determine if the given path exists on the remote machine.
 * @param path The path to check.
 * @returns True if the path exists.
 */
export async function resolvePathRemote(path: string): Promise<string | undefined> {
    const resp = await GlobalModel.submitEphemeralCommand(
        "eval",
        null,
        [`if [ -d "${path}" ]; then cd "${path}" || return 1; pwd; else return 1; fi`],
        null,
        false,
        {
            expectsresponse: true,
            env: {},
        }
    );
    const output = await GlobalModel.getEphemeralCommandOutput(resp);
    log.debug("pathExistsRemote", path, output);
    return output.stderr?.length > 0 ? undefined : output.stdout.trimEnd();
}

/**
 * Runs the comparator function on each value and returns true if any of them match
 * @param values The value(s) to check
 * @param comparator The function to use to compare the values
 * @returns True if any of the values match the comparator
 */
export function matchAny<T>(values: Fig.SingleOrArray<T>, comparator: (a: T) => boolean) {
    if (Array.isArray(values)) {
        for (const value of values) {
            if (comparator(value)) {
                return true;
            }
        }
        return false;
    } else {
        return comparator(values);
    }
}

/**
 * Checks if any of the values start with the input string
 * @param values The value(s) to check
 * @param input The input to check against
 * @returns True if any of the values start with the input
 */
export function startsWithAny(values: Fig.SingleOrArray<string>, input: string) {
    return matchAny(values, (a) => a.startsWith(input));
}

/**
 * Checks if any of the values are not equal to the input
 * @param values The value(s) to check
 * @param input The input to check against
 * @returns True if any of the values are not equal to the input
 */
export function equalsAny<T>(values: Fig.SingleOrArray<T>, input: T) {
    return matchAny(values, (a) => a == input);
}

/**
 * Checks if any of the values of the SingleOrArray are not in the array
 * @param values The value(s) to check
 * @param arr The array to check against
 * @returns True if any of the values are not in the array
 */
export function notInAny<T>(values: Fig.SingleOrArray<T>, arr: T[]) {
    return matchAny(values, (a) => !arr.includes(a));
}

/**
 * Get the first element of a Fig.SingleOrArray<T>.
 * @param values Either a single value or an array of values of the specified type.
 * @returns The first element of the array, or the value.
 */
export function getFirst<T>(values: Fig.SingleOrArray<T>): T {
    if (Array.isArray(values)) {
        return values[0];
    }
    return values;
}

/**
 * Get all elements of a Fig.SingleOrArray<T>
 * @param values Either a single value or an array of values of the specified type.
 * @returns The array of values, or an empty array
 */
export function getAll<T>(values: Fig.SingleOrArray<T> | undefined): T[] {
    if (Array.isArray(values)) {
        return values;
    }
    return [values as T];
}

/**
 * Checks if a string is an option, i.e. starts with "--".
 * @param value The string to check.
 * @returns True if the string is an option.
 */
export function isOption(value: string): boolean {
    return value.startsWith("--");
}

/**
 * Checks if a string is a flag, i.e. starts with "-" but not "--".
 * @param value The string to check.
 * @returns True if the string is a flag.
 */
export function isFlag(value: string): boolean {
    return value.startsWith("-") && !isOption(value);
}

/**
 * Checks if a string is either a flag or an option, i.e. starts with "-".
 * @param value The string to check.
 * @returns True if the string is a flag or an option.
 */
export function isFlagOrOption(value: string): boolean {
    return value.startsWith("-");
}

export function isPath(value: string, shell: Shell): boolean {
    return value.includes(getPathSep(shell));
}

/**
 * Get the flag of a Fig.SingleOrArray<string>.
 * @param values Either a string or an array of strings.
 * @returns The flag, or undefined if none is found.
 */
export function getFlag(values: Fig.SingleOrArray<string>): string | undefined {
    if (Array.isArray(values)) {
        for (const value of values) {
            if (isFlag(value)) {
                return value;
            }
        }
    } else if (isFlag(values)) {
        return values;
    }
    return undefined;
}

export function determineTokenType(value: string, shell: Shell): TokenType {
    if (isOption(value)) {
        return TokenType.OPTION;
    } else if (isFlag(value)) {
        return TokenType.FLAG;
    } else if (isPath(value, shell)) {
        return TokenType.PATH;
    } else {
        return TokenType.ARGUMENT;
    }
}

/**
 * Checks if an option suggestion contains a flag. If so, modifies the name to include the preceding flags.
 * @param option The option to modify.
 * @param precedingFlags The preceding flags to prepend to the suggestion name.
 * @returns The modified option suggestion.
 */
export function modifyPosixFlags(option: Fig.Option, precedingFlags: string): Fig.Option {
    // We only want to modify the name if the option is a flag
    if (option.name) {
        // Get the name of the flag without the preceding "-"
        const name = getFlag(option.name)?.slice(1);

        if (name) {
            // Shallow copy the option so we can modify the name without modifying the original spec.
            option = { ...option };

            // We want to prepend the existing flags to the name, except for the suggestion of the last flag (i.e. the `c` of an input `-abc`), which we want to replace with the existing flags.
            // The end result is that we will suggest -abc instead of -a -b -c. We do not want -abb. The case of -aba should already be covered by filterFlags.
            if (name === precedingFlags?.at(-1)) {
                option.name = "-" + precedingFlags;
            } else {
                option.name = "-" + precedingFlags + name;
            }
        }
    }
    return option;
}

/**
 * Sort suggestions in-place by priority, then by name.
 * @param suggestions The suggestions to sort.
 */
export function sortSuggestions(suggestions: Fig.Suggestion[]) {
    suggestions.sort((a, b) => {
        if (a.priority == b.priority) {
            if (a.name) {
                if (b.name) {
                    return getFirst(a.name).trim().localeCompare(getFirst(b.name));
                } else {
                    return -1;
                }
            } else if (b.name) {
                return 1;
            }
        }
        return (b.priority ?? 0) - (a.priority ?? 0);
    });
}

/**
 * Merge two subcommand objects, with the second subcommand taking precedence in case of conflicts.
 * @param subcommand1 The first subcommand.
 * @param subcommand2 The second subcommand.
 * @returns The merged subcommand.
 */
export function mergeSubcomands(subcommand1: Fig.Subcommand, subcommand2: Fig.Subcommand): Fig.Subcommand {
    log.debug("merging two subcommands", subcommand1, subcommand2);
    const newCommand: Fig.Subcommand = { ...subcommand1 };

    // Merge the generated spec with the existing spec
    for (const key in subcommand2) {
        if (Array.isArray(subcommand2[key])) {
            newCommand[key] = [...subcommand2[key], ...(newCommand[key] ?? [])];
            continue;
        } else if (typeof subcommand2[key] === "object") {
            newCommand[key] = { ...subcommand2[key], ...(newCommand[key] ?? {}) };
        } else {
            newCommand[key] = subcommand2[key];
        }
    }
    log.debug("merged subcommand:", newCommand);
    return newCommand;
}
