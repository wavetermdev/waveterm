// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/utils.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

/**
 * Determine if the current token is a path or not. If it is an incomplete path, return the base name of the path as the new cwd to be used in downstream parsing operations. Otherwise, return the current cwd.
 * @param token The token to check.
 * @param cwd The current working directory.
 * @param shell The shell being used.
 * @returns The new cwd, whether the token is a path, and whether the path is complete.
 */
export const resolveCwdToken = async (
    token: string,
    cwd: string,
    shell: Shell
): Promise<{ cwd: string; pathy: boolean; complete: boolean }> => {
    if (token == null) return { cwd, pathy: false, complete: false };
    const sep = shell == Shell.Bash ? "/" : getApi().pathSep();
    if (!token.includes(sep)) return { cwd, pathy: false, complete: false };
    const complete = token.endsWith(sep);
    return { cwd: complete ? getApi().pathBaseName(token) : cwd, pathy: true, complete };
};

/**
 * Retrieves the contents of the specified directory on the active remote machine.
 * @param cwd The directory whose contents should be returned.
 * @param tempType The template to use when returning the contents. If "folders" is passed, only the directories within the specified directory will be returned. Otherwise, all the contents will be returned.
 * @returns The contents of the directory formatted to the specified template.
 */
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

/**
 * Checks if a string is a command, i.e. not a flag or option.
 * @param value The string to check.
 * @returns True if the string is a command.
 */
export function isCommand(value: string): boolean {
    return !isFlag(value) && !isOption(value);
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
            if (name === precedingFlags.at(-1)) {
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
