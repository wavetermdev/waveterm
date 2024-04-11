// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { isBlank } from "@/util/util";

const VALID_CSS_VARIABLES = [
    "--term-black",
    "--term-red",
    "--term-green",
    "--term-yellow",
    "--term-blue",
    "--term-magenta",
    "--term-cyan",
    "--term-white",
    "--term-bright-black",
    "--term-bright-red",
    "--term-bright-green",
    "--term-bright-yellow",
    "--term-bright-blue",
    "--term-bright-magenta",
    "--term-bright-cyan",
    "--term-bright-white",
    "--term-gray",
    "--term-cmdtext",
    "--term-foreground",
    "--term-background",
    "--term-selection-background",
    "--term-cursor-accent",
];

@mobxReact.observer
class TermStyleBlock extends React.Component<{
    termTheme: TermThemeType;
}> {
    styleRules: OV<string> = mobx.observable.box("", { name: "StyleBlock-styleRules" });
    theme: string;
    injectedStyleElement: HTMLStyleElement | null = null;

    componentDidMount(): void {
        const { termTheme } = this.props;
        Object.keys(termTheme).forEach((themeKey) => {
            // this.loadThemeStyles();
        });
    }

    componentDidUpdate(): void {
        const { termTheme } = this.props;
        const selector = GlobalModel.termThemeScope.get("selector");
        const themeKey = GlobalModel.termThemeScope.get("themeKey");
        const reset = GlobalModel.termThemeScope.get("reset");
        const currTheme = termTheme[themeKey];

        console.log("reset:=========", reset);

        if (reset) {
            this.removeInjectedStyle();
        } else if (this.theme !== currTheme) {
            this.loadThemeStyles(selector, themeKey);
        }
    }

    isValidCSSColor(color) {
        const element = document.createElement("div");
        element.style.color = color;
        return element.style.color !== "";
    }

    isValidTermCSSVariable(key, value) {
        const cssVarName = `--term-${key}`;
        return VALID_CSS_VARIABLES.includes(cssVarName);
    }

    camelCaseToKebabCase(str) {
        return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    }

    removeInjectedStyle() {
        if (this.injectedStyleElement) {
            document.head.removeChild(this.injectedStyleElement);
            this.injectedStyleElement = null;
        }
    }

    loadThemeStyles(selector: string, themeKey: string) {
        const { termTheme } = this.props;

        const currTheme = termTheme[themeKey];

        console.log("selector:", selector);
        console.log("themeKey:", themeKey);

        // Inject new style element
        GlobalModel.getTermThemeJson(currTheme)
            .then((termThemeJson) => {
                if (termThemeJson && typeof termThemeJson === "object") {
                    const styleProperties = Object.entries(termThemeJson)
                        .filter(([key, value]) => {
                            const cssVarName = `--term-${this.camelCaseToKebabCase(key)}`;
                            return VALID_CSS_VARIABLES.includes(cssVarName) && this.isValidCSSColor(value);
                        })
                        .map(([key, value]) => `--term-${key}: ${value};`)
                        .join(" ");

                    const style = document.createElement("style");
                    style.innerHTML = `${selector} { ${styleProperties} }`;
                    document.head.appendChild(style);

                    this.injectedStyleElement = style;
                    this.theme = currTheme;

                    console.log("loaded theme styles:", this.styleRules.get());
                } else {
                    console.error("termThemeJson is not an object:", termThemeJson);
                }
            })
            .then(() => {
                GlobalModel.bumpTermRenderVersion();
            })
            .catch((error) => {
                console.error("error loading theme styles:", error);
            });
    }

    render() {
        return null;
    }
}

export { TermStyleBlock };
