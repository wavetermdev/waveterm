// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fsAsync from "node:fs/promises";
import log from "../utils/log.js";

const filepathsTemplate = async (cwd: string): Promise<Fig.TemplateSuggestion[]> => {
  const files = await fsAsync.readdir(cwd, { withFileTypes: true });
  return files.filter((f) => f.isFile() || f.isDirectory()).map((f) => ({ name: f.name, priority: 55, context: { templateType: "filepaths" } }));
};

const foldersTemplate = async (cwd: string): Promise<Fig.TemplateSuggestion[]> => {
  const files = await fsAsync.readdir(cwd, { withFileTypes: true });
  return files.filter((f) => f.isDirectory()).map((f) => ({ name: f.name, priority: 55, context: { templateType: "folders" } }));
};

// TODO: implement history template
const historyTemplate = (): Fig.TemplateSuggestion[] => {
  return [];
};

// TODO: implement help template
const helpTemplate = (): Fig.TemplateSuggestion[] => {
  return [];
};

export const runTemplates = async (template: Fig.TemplateStrings[] | Fig.Template, cwd: string): Promise<Fig.TemplateSuggestion[]> => {
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
      }),
    )
  ).flat();
};
