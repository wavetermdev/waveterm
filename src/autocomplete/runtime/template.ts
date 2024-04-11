// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/template.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import log from "../utils/log";
import { getCompletionSuggestions } from "./utils";

const filepathsTemplate = async (cwd: string): Promise<Fig.TemplateSuggestion[]> => {
    return await getCompletionSuggestions(cwd, "filepaths");
};

const foldersTemplate = async (cwd: string): Promise<Fig.TemplateSuggestion[]> => {
    return await getCompletionSuggestions(cwd, "folders");
};

// TODO: implement history template
const historyTemplate = (): Fig.TemplateSuggestion[] => {
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
