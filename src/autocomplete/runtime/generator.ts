// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/generator.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GlobalModel } from "@/models";
import log from "../utils/log";
import { runTemplates } from "./template";
import { buildExecuteShellCommand } from "./utils";

const getGeneratorContext = async (cwd: string): Promise<Fig.GeneratorContext> => {
    const resp = await GlobalModel.submitEphemeralCommand("eval", null, ["env"], null, false, {
        expectsresponse: true,
        overridecwd: cwd,
        env: null,
    });

    const { stdout, stderr } = await GlobalModel.getEphemeralCommandOutput(resp);
    if (stderr) {
        log.debug({ msg: "failed to get environment variables", stderr });
    }

    const env = {};
    stdout
        .split("\n")
        .filter((s) => s.length > 0)
        .forEach((line) => {
            const [key, value] = line.split("=");
            env[key] = value;
        });
    return {
        environmentVariables: env,
        currentWorkingDirectory: cwd,
        currentProcess: "", // TODO: define current process
        sshPrefix: "", // deprecated, should be empty
        isDangerous: false,
        searchTerm: "", // TODO: define search term
    };
};

let lastToken = "";
let cachedSuggestions: Fig.Suggestion[] = [];

// TODO: add support getQueryTerm
export const runGenerator = async (
    generator: Fig.Generator,
    tokens: string[],
    cwd: string
): Promise<Fig.Suggestion[]> => {
    const { script, postProcess, scriptTimeout, splitOn, custom, template, filterTemplateSuggestions, trigger } =
        generator;

    const newToken = tokens.at(-1);

    if (trigger) {
        log.debug("trigger", trigger);
        if (typeof trigger === "string") {
            if (!newToken?.includes(trigger)) {
                log.debug("trigger string", newToken, trigger);
                return cachedSuggestions;
            }
        } else if (typeof trigger === "function") {
            log.debug("trigger function", newToken, lastToken);
            if (!trigger(newToken, lastToken)) {
                log.debug("trigger function false");
                return cachedSuggestions;
            } else {
                log.debug("trigger function true");
            }
        } else {
            switch (trigger.on) {
                case "change": {
                    log.debug("trigger change", newToken, lastToken);
                    if (lastToken && newToken && lastToken === newToken) {
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
                    log.debug("trigger threshold", newToken, lastToken, trigger.length);
                    if (Math.abs(newToken.length - lastToken.length) < trigger.length) {
                        log.debug("trigger threshold false");
                        return cachedSuggestions;
                    } else {
                        log.debug("trigger threshold true");
                    }
                    break;
                }
            }
        }
    } else if (lastToken && newToken && lastToken === newToken) {
        log.debug("lastToken === newToken", lastToken, newToken);
        return cachedSuggestions;
    }
    log.debug("lastToken !== newToken", lastToken, newToken);

    const executeShellCommand = buildExecuteShellCommand(scriptTimeout ?? 5000);
    const suggestions = [];
    try {
        if (script) {
            const shellInput = typeof script === "function" ? script(tokens) : script;
            const scriptOutput = Array.isArray(shellInput)
                ? await executeShellCommand({ command: shellInput.at(0) ?? "", args: shellInput.slice(1), cwd })
                : await executeShellCommand({ ...shellInput, cwd });

            const scriptStdout = scriptOutput.stdout.trim();
            if (postProcess) {
                suggestions.push(...postProcess(scriptStdout, tokens));
            } else if (splitOn) {
                suggestions.push(...scriptStdout.split(splitOn).map((s) => ({ name: s })));
            }
        }

        if (custom) {
            log.debug("custom", custom);
            suggestions.push(...(await custom(tokens, executeShellCommand, await getGeneratorContext(cwd))));
        }

        if (template != null) {
            const templateSuggestions = await runTemplates(template, cwd);
            if (filterTemplateSuggestions) {
                suggestions.push(...filterTemplateSuggestions(templateSuggestions));
            } else {
                suggestions.push(...templateSuggestions);
            }
        }
        lastToken = tokens[-1];
        cachedSuggestions = suggestions;
        return suggestions;
    } catch (e) {
        const err = typeof e === "string" ? e : e instanceof Error ? e.message : e;
        log.debug({ msg: "generator failed", err, script, splitOn, template });
    }
    return suggestions;
};
