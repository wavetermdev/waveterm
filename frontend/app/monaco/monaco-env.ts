// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getResolvedTheme } from "@/app/hook/usetheme";
import * as monaco from "monaco-editor";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import { configureMonacoYaml } from "monaco-yaml";

import { MonacoSchemas } from "@/app/monaco/schemaendpoints";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import ymlWorker from "./yamlworker?worker";

let monacoConfigured = false;

window.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === "json") {
            return new jsonWorker();
        }
        if (label === "css" || label === "scss" || label === "less") {
            return new cssWorker();
        }
        if (label === "yaml" || label === "yml") {
            return new ymlWorker();
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
            return new htmlWorker();
        }
        if (label === "typescript" || label === "javascript") {
            return new tsWorker();
        }
        return new editorWorker();
    },
};

export function loadMonaco() {
    if (monacoConfigured) {
        return;
    }
    monacoConfigured = true;
    monaco.editor.defineTheme("wave-theme-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": "#00000000",
            "editorStickyScroll.background": "#00000055",
            "minimap.background": "#00000077",
            focusBorder: "#00000000",
        },
    });
    monaco.editor.defineTheme("wave-theme-light", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": "#fefefe",
            focusBorder: "#00000000",
        },
    });
    configureMonacoYaml(monaco, {
        validate: true,
        schemas: [],
    });
    // Set initial theme based on resolved theme
    const resolvedTheme = getResolvedTheme();
    const monacoTheme = resolvedTheme === "light" ? "wave-theme-light" : "wave-theme-dark";
    monaco.editor.setTheme(monacoTheme);

    // Watch for theme changes via data-theme attribute on document root
    const themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.attributeName === "data-theme") {
                const newTheme = document.documentElement.getAttribute("data-theme");
                const newMonacoTheme = newTheme === "light" ? "wave-theme-light" : "wave-theme-dark";
                monaco.editor.setTheme(newMonacoTheme);
            }
        }
    });
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
    });

    // Disable default validation errors for typescript and javascript
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
    });
    monaco.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        enableSchemaRequest: true,
        schemas: MonacoSchemas,
    });
}
