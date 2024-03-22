// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import log from "../utils/log.js";
import { runTemplates } from "./template.js";
import { buildExecuteShellCommand } from "./utils.js";

const getGeneratorContext = (cwd: string): Fig.GeneratorContext => {
  return {
    environmentVariables: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)),
    currentWorkingDirectory: cwd,
    currentProcess: "", // TODO: define current process
    sshPrefix: "", // deprecated, should be empty
    isDangerous: false,
    searchTerm: "", // TODO: define search term
  };
};

// TODO: add support for caching, trigger, & getQueryTerm
export const runGenerator = async (generator: Fig.Generator, tokens: string[], cwd: string): Promise<Fig.Suggestion[]> => {
  // TODO: support trigger
  const { script, postProcess, scriptTimeout, splitOn, custom, template, filterTemplateSuggestions } = generator;

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
      suggestions.push(...(await custom(tokens, executeShellCommand, getGeneratorContext(cwd))));
    }

    if (template != null) {
      const templateSuggestions = await runTemplates(template, cwd);
      if (filterTemplateSuggestions) {
        suggestions.push(...filterTemplateSuggestions(templateSuggestions));
      } else {
        suggestions.push(...templateSuggestions);
      }
    }
    return suggestions;
  } catch (e) {
    const err = typeof e === "string" ? e : e instanceof Error ? e.message : e;
    log.debug({ msg: "generator failed", err, script, splitOn, template });
  }
  return suggestions;
};
