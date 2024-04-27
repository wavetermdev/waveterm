// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/template.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GlobalModel } from "@/models";
import log from "../utils/log";

/**
 * Retrieves the contents of the specified directory on the active remote machine.
 * @param cwd The directory whose contents should be returned.
 * @param tempType The template to use when returning the contents. If "folders" is passed, only the directories within the specified directory will be returned. Otherwise, all the contents will be returned.
 * @returns The contents of the directory formatted to the specified template.
 */
export const getFileCompletionSuggestions = async (
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
            if (firstData.info.infocomps.length === 0) return [];
            if (firstData.info.infocomps[0] === "(no completions)") return [];
            return firstData.info.infocomps.map((comp: string) => {
                log.debug("getFileCompletionSuggestions", cwd, comp);
                return {
                    name: comp,
                    displayName: comp,
                    priority: comp.startsWith(".") ? 1 : 55,
                    context: { templateType: tempType },
                    type: comp.endsWith("/") ? "folder" : "file",
                };
            });
        } else {
            return [];
        }
    }
};

const historyTemplate = (cwd: String): Fig.TemplateSuggestion[] => {
    const inputModel = GlobalModel.inputModel;
    const cmdLine = inputModel.curLine;
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
                    hmap.set(cmdstr, {
                        name: cmdstr,
                        priority: 90,
                        context: {
                            templateType: "history",
                        },
                        icon: "🕒",
                        type: "special",
                    });
                }
            }
        });
        const ret = Array.from(hmap.values());
        log.debug("historyTemplate ret", ret);
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
                            return await getFileCompletionSuggestions(cwd, "filepaths");
                        case "folders":
                            return await getFileCompletionSuggestions(cwd, "folders");
                        case "history":
                            return historyTemplate(cwd);
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
