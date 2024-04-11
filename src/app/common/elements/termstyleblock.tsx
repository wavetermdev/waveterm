// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";

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
    injectedStyleElement: HTMLStyleElement | null = null;

    componentDidUpdate(): void {
        const { termTheme } = this.props;
        for (const key of Object.keys(termTheme)) {
            const selector = this.getSelector(key);
            if (selector) {
                this.removeInjectedStyle();
                this.loadThemeStyles(selector, termTheme[key]);
                break;
            }
        }
    }

    getSelector(themeKey: string) {
        const session = GlobalModel.getActiveSession();
        const activeSessionId = session.sessionId;
        const screen = GlobalModel.getActiveScreen();
        const activeScreenId = screen.screenId;

        if (themeKey == activeScreenId) {
            return `.main-content [data-screenid="${activeScreenId}"]`;
        } else if (themeKey == activeSessionId) {
            return `.main-content [data-sessionid="${activeSessionId}"]`;
        } else if (themeKey == "main") {
            return ".main-content";
        }
        return null;
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

    loadThemeStyles(selector: string, theme: string) {
        // Inject new style element
        GlobalModel.getTermThemeJson(theme)
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
        // To trigger componentDidUpdate when switching between sessions/screens
        GlobalModel.getActiveSession();
        GlobalModel.getActiveScreen();

        return null;
    }
}

export { TermStyleBlock };
