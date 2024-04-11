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

    componentDidMount(): void {
        this.loadThemeStyles();
    }

    componentDidUpdate(prevProps): void {
        const { termTheme } = this.props;
        const themeKey = GlobalModel.termThemeScope.get("themeKey");
        const currTheme = termTheme[themeKey];
        if (themeKey !== prevProps.themeKey) {
            this.loadThemeStyles();
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

    loadThemeStyles() {
        const { termTheme } = this.props;
        const selector = GlobalModel.termThemeScope.get("selector");
        const themeKey = GlobalModel.termThemeScope.get("themeKey");
        const currTheme = termTheme[themeKey];
        console.log("selector", selector);
        console.log("themeKey", themeKey);
        console.log("currTheme", currTheme);
        console.log("this.theme", this.theme);

        // if (currTheme && currTheme !== this.theme && currTheme) {
        const rtn = GlobalModel.getTermThemeJson(currTheme);
        rtn.then((termThemeJson) => {
            if (termThemeJson && typeof termThemeJson === "object") {
                const styleProperties = Object.entries(termThemeJson)
                    .filter(([key, value]) => {
                        const cssVarName = `--term-${this.camelCaseToKebabCase(key)}`;
                        return VALID_CSS_VARIABLES.includes(cssVarName) && this.isValidCSSColor(value);
                    })
                    .map(([key, value]) => `--term-${key}: ${value};`)
                    .join(" ");

                mobx.action(() => {
                    this.styleRules.set(`:root { ${styleProperties} }`);
                    GlobalModel.termThemeScope.set(selector);
                })();
                console.log("loaded theme styles:", this.styleRules.get());
            } else {
                console.error("termThemeJson is not an object:", termThemeJson);
            }
        })
            .then(() => {
                GlobalModel.bumpTermRenderVersion();
                this.theme = currTheme;
            })
            .catch((error) => {
                console.error("error loading theme styles:", error);
            });
        // }
        // else {
        //     mobx.action(() => {
        //         this.styleRules.set("");
        //         GlobalModel.termThemeScope.set(null);
        //     })();
        //     this.theme = currTheme;
        //     GlobalModel.bumpTermRenderVersion();
        // }
    }

    render() {
        if (isBlank(this.styleRules.get())) {
            return null;
        }
        return <style>{this.styleRules.get()}</style>;
    }
}

export { TermStyleBlock };
