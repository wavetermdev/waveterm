// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { GlobalModel } from "@/models";
import ReactDOM from "react-dom";
import { For } from "tsx-control-statements/components";
import * as mobx from "mobx";

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
class TermStyle extends React.Component<{
    themeName: string;
    selector: string;
}> {
    componentDidMount() {
        GlobalModel.bumpTermRenderVersion();
    }

    componentWillUnmount() {
        GlobalModel.bumpTermRenderVersion();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.themeName !== this.props.themeName || prevProps.selector !== this.props.selector) {
            GlobalModel.bumpTermRenderVersion();
        }
    }

    isValidCSSColor(color) {
        const element = document.createElement("div");
        element.style.color = color;
        return element.style.color !== "";
    }

    camelCaseToKebabCase(str) {
        return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    }

    getStyleRules() {
        const { selector, themeName } = this.props;
        const termThemeOptions = GlobalModel.getTermThemeOptions();
        const theme = termThemeOptions[themeName];
        if (!theme) {
            return null;
        }
        const styleProperties = Object.entries(theme)
            .filter(([key, value]) => {
                const cssVarName = `--term-${this.camelCaseToKebabCase(key)}`;
                return VALID_CSS_VARIABLES.includes(cssVarName) && this.isValidCSSColor(value);
            })
            .map(([key, value]) => `--term-${key}: ${value};`)
            .join(" ");

        if (!styleProperties) {
            return null;
        }
        return `${selector} { ${styleProperties} }`;
    }

    render() {
        const styleRules = this.getStyleRules();
        if (!styleRules) {
            return null;
        }
        return ReactDOM.createPortal(<style>{styleRules}</style>, document.head);
    }
}

@mobxReact.observer
class TermStyleList extends React.Component<{ children: (termStylesRendered: boolean) => React.ReactNode }, {}> {
    termStylesRendered: OV<boolean> = mobx.observable.box(false, { name: "termStylesRendered" });

    componentDidMount(): void {
        mobx.action(() => {
            this.termStylesRendered.set(true);
        })();
    }

    getSelector(themeKey: string) {
        const sessions = GlobalModel.getSessionNames();
        const screens = GlobalModel.getScreenNames();

        if (themeKey === "main") {
            return ":root";
        } else if (themeKey in screens) {
            return `.main-content [data-screenid="${themeKey}"]`;
        } else if (themeKey in sessions) {
            return `.main-content [data-sessionid="${themeKey}"]`;
        }

        return null;
    }

    render() {
        const termTheme = GlobalModel.getTermTheme();
        const themeKey = null;

        return (
            <>
                <For index="idx" each="themeKey" of={Object.keys(termTheme)}>
                    <TermStyle key={themeKey} themeName={termTheme[themeKey]} selector={this.getSelector(themeKey)} />
                </For>
                {this.props.children(this.termStylesRendered.get())}
            </>
        );
    }
}

export { TermStyleList };
