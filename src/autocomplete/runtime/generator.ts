// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/generator.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import log from "../utils/log";
import { runTemplates } from "./template";
import { buildExecuteShellCommand, getEnvironmentVariables } from "./utils";

async function getGeneratorContext(cwd: string, env?: Record<string, string>): Promise<Fig.GeneratorContext> {
    return {
        environmentVariables: env ?? (await getEnvironmentVariables(cwd)),
        currentWorkingDirectory: cwd,
        currentProcess: "", // TODO: define current process
        sshPrefix: "", // deprecated, should be empt
        isDangerous: false,
        searchTerm: "", // TODO: define search term
    };
}

let lastFirstToken = "";
let lastFinalToken = "";
let cachedSuggestions: Fig.Suggestion[] = [];

// TODO: add support getQueryTerm
export async function runGenerator(
    generator: Fig.Generator,
    tokens: string[],
    cwd: string,
    env?: Record<string, string>
): Promise<Fig.Suggestion[]> {
    const { script, postProcess, scriptTimeout, splitOn, custom, template, filterTemplateSuggestions, trigger } =
        generator;

    const newToken = tokens.at(-1) ?? "";

    if (lastFirstToken == tokens.at(0) && trigger && cachedSuggestions.length > 0) {
        log.debug("trigger", trigger);
        if (typeof trigger === "string") {
            if (!newToken?.includes(trigger)) {
                log.debug("trigger string", newToken, trigger);
                return cachedSuggestions;
            }
        } else if (typeof trigger === "function") {
            log.debug("trigger function", "newToken:", newToken, "lastToken: ", lastFinalToken);
            if (!trigger(newToken, lastFinalToken ?? "")) {
                log.debug("trigger function false");
                return cachedSuggestions;
            } else {
                log.debug("trigger function true");
            }
        } else {
            switch (trigger.on) {
                case "change": {
                    log.debug("trigger change", newToken, lastFinalToken);
                    if (lastFinalToken && newToken && lastFinalToken === newToken) {
                        log.debug("trigger change false");
                        return cachedSuggestions;
                    } else {
                        log.debug("trigger change true");
                    }
                    break;
                }
                case "match": {
                    if (Array.isArray(trigger.string)) {
                        log.debug("trigger match array", newToken, trigger.string);
                        if (!trigger.string.some((t) => newToken === t)) {
                            log.debug("trigger match false");
                            return cachedSuggestions;
                        } else {
                            log.debug("trigger match true");
                        }
                    } else if (trigger.string !== newToken) {
                        log.debug("trigger match single true", newToken, trigger.string);
                        return cachedSuggestions;
                    } else {
                        log.debug("trigger match single false", newToken, trigger.string);
                    }
                    break;
                }
                case "threshold": {
                    log.debug("trigger threshold", newToken, lastFinalToken, trigger.length);
                    if (Math.abs(newToken.length - lastFinalToken.length) < trigger.length) {
                        log.debug("trigger threshold false");
                        return cachedSuggestions;
                    } else {
                        log.debug("trigger threshold true");
                    }
                    break;
                }
            }
        }
    } else if (lastFirstToken === tokens.at(0) && newToken && lastFinalToken === newToken) {
        log.debug("lastToken === newToken", lastFinalToken, newToken);
        return cachedSuggestions;
    }
    log.debug("lastToken !== newToken", lastFinalToken, newToken);

    const executeShellCommand = buildExecuteShellCommand(scriptTimeout ?? 5000);
    const suggestions = [];
    lastFinalToken = tokens[-1];
    lastFirstToken = tokens[0];
    try {
        if (script) {
            const shellInput = typeof script === "function" ? script(tokens) : script;
            const scriptOutput = Array.isArray(shellInput)
                ? await executeShellCommand({ command: shellInput.at(0) ?? "", args: shellInput.slice(1), cwd })
                : await executeShellCommand({ ...shellInput, cwd });

            const scriptStdout = scriptOutput.stdout.trim();
            const scriptStderr = scriptOutput.stderr.trim();
            if (scriptStderr) {
                log.debug("script error, skipping processing", scriptStderr);
            } else if (postProcess) {
                suggestions.push(...postProcess(scriptStdout, tokens));
            } else if (splitOn) {
                suggestions.push(...scriptStdout.split(splitOn).map((s) => ({ name: s })));
            }
        }

        if (custom) {
            log.debug("custom", custom);
            const customSuggestions = await custom(tokens, executeShellCommand, await getGeneratorContext(cwd, env));
            log.debug("customSuggestions", customSuggestions);
            suggestions.push(...customSuggestions);
        }

        if (template != null) {
            const templateSuggestions = await runTemplates(template, cwd);
            if (filterTemplateSuggestions) {
                suggestions.push(...filterTemplateSuggestions(templateSuggestions));
            } else {
                suggestions.push(...templateSuggestions);
            }
        }
        cachedSuggestions = suggestions;
        return suggestions;
    } catch (e) {
        const err = typeof e === "string" ? e : e instanceof Error ? e.message : e;
        log.debug({ msg: "generator failed", err, script, splitOn, template });
    }
    return suggestions;
}
