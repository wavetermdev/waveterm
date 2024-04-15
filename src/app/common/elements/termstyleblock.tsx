// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
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
    themeName: string;
    selector: string;
}> {
    componentDidUpdate(): void {
        GlobalModel.bumpTermRenderVersion();
    }

    isValidCSSColor(color) {
        const element = document.createElement("div");
        element.style.color = color;
        return element.style.color !== "";
    }

    isValidTermCSSVariable(key) {
        const cssVarName = `--term-${key}`;
        return VALID_CSS_VARIABLES.includes(cssVarName);
    }

    camelCaseToKebabCase(str) {
        return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    }

    getStyleRules() {
        const { selector, themeName } = this.props;
        const termThemeOptions = GlobalModel.getTermThemeOptions();
        if (!termThemeOptions) {
            return null;
        }
        const theme = termThemeOptions[themeName];
        if (!theme) {
            return null;
        }
        const styleProperties = Object.entries(theme)
            // .filter(([key, value]) => {
            //     const cssVarName = `--term-${this.camelCaseToKebabCase(key)}`;
            //     return this.isValidTermCSSVariable(cssVarName) && this.isValidCSSColor(value);
            // })
            .map(([key, value]) => `--term-${key}: ${value};`)
            .join(" ");

        if (!styleProperties) {
            return null;
        }
        return `${selector} { ${styleProperties} }`;
    }

    render() {
        const styleRules = this.getStyleRules();

        return styleRules ? <style>{styleRules}</style> : null;
    }
}

export { TermStyleBlock };
