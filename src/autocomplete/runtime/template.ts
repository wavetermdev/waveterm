// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/template.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GlobalModel } from "@/models";
import log from "../utils/log";
import { getCompletionSuggestions } from "./utils";

const filepathsTemplate = async (cwd: string): Promise<Fig.TemplateSuggestion[]> => {
    return await getCompletionSuggestions(cwd, "filepaths");
};

const foldersTemplate = async (cwd: string): Promise<Fig.TemplateSuggestion[]> => {
    return await getCompletionSuggestions(cwd, "folders");
};

const historyTemplate = (): Fig.TemplateSuggestion[] => {
    const inputModel = GlobalModel.inputModel;
    const cmdLine = inputModel.curLine;
    const cmdLineMinusLastToken = cmdLine.substring(0, cmdLine.lastIndexOf(" "));
    log.debug("historyTemplate", cmdLine);
    inputModel.loadHistory(false, 0, "screen");
    const hitems = GlobalModel.inputModel.filteredHistoryItems;
    if (hitems.length > 0) {
        const hmap: Map<string, Fig.TemplateSuggestion> = new Map();
        hitems.forEach((h) => {
            const cmdstr = h.cmdstr.trim();
            if (cmdstr.startsWith(cmdLine)) {
                if (hmap.has(cmdstr)) {
                    hmap.get(cmdstr).priority += 1;
                } else {
                    const insertValue = cmdstr.replace(cmdLineMinusLastToken, "").trim();
                    log.debug("historyTemplate insertValue", insertValue);
                    hmap.set(cmdstr, {
                        name: cmdstr,
                        priority: 60,
                        context: {
                            templateType: "history",
                        },
                        insertValue,
                        type: "special",
                    });
                }
            }
        });
        const ret = Array.from(hmap.values());
        log.debug("historyTemplate", ret);
        return ret;
    }
    return [];
};

// TODO: implement help template
const helpTemplate = (): Fig.TemplateSuggestion[] => {
    return [];
};

export const runTemplates = async (
    template: Fig.TemplateStrings[] | Fig.Template,
    cwd: string
): Promise<Fig.TemplateSuggestion[]> => {
    const templates = template instanceof Array ? template : [template];
    log.debug("runTemplates", templates, cwd);
    return (
        await Promise.all(
            templates.map(async (t) => {
                try {
                    switch (t) {
                        case "filepaths":
                            return await filepathsTemplate(cwd);
                        case "folders":
                            return await foldersTemplate(cwd);
                        case "history":
                            return historyTemplate();
                        case "help":
                            return helpTemplate();
                    }
                } catch (e) {
                    log.debug({ msg: "template failed", e, template: t, cwd });
                    return [];
                }
            })
        )
    ).flat();
};
