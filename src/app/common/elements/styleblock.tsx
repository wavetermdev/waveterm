// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { isBlank } from "@/util/util";

@mobxReact.observer
class StyleBlock extends React.Component<
    { themeSrcEl: HTMLElement; themeKey: string; className: string; termTheme: TermThemeType },
    { styleRules: string }
> {
    styleRules: OV<string> = mobx.observable.box("", { name: "StyleBlock-styleRules" });
    theme: string;

    componentDidMount(): void {
        GlobalModel.termThemeSrcEl.set(this.props.themeSrcEl);
        this.loadThemeStyles();
    }

    componentDidUpdate(prevProps): void {
        const { themeKey, termTheme } = this.props;
        const currTheme = termTheme[themeKey];
        if (themeKey !== prevProps.themeKey || currTheme !== this.theme) {
            this.loadThemeStyles();
        }
        if (this.props.themeSrcEl !== prevProps.themeSrcEl) {
            GlobalModel.termThemeSrcEl.set(this.props.themeSrcEl);
        }
    }

    async loadThemeStyles() {
        const { themeKey, className, termTheme } = this.props;
        const currTheme = termTheme[themeKey];

        if (currTheme !== this.theme && currTheme) {
            const rtn = GlobalModel.getTermThemeJson(currTheme);
            rtn.then((termThemeJson) => {
                if (termThemeJson && typeof termThemeJson === "object") {
                    const styleProperties = Object.entries(termThemeJson)
                        .map(([key, value]) => `--term-${key}: ${value};`)
                        .join(" ");

                    this.styleRules.set(`${className} { ${styleProperties} }`);
                    GlobalModel.bumpTermRenderVersion();
                    this.theme = currTheme;
                } else {
                    console.error("termThemeJson is not an object:", termThemeJson);
                }
            }).catch((error) => {
                console.error("error loading theme styles:", error);
            });
        }
    }

    render() {
        console.log("this.styleRules", this.styleRules.get());

        if (isBlank(this.styleRules.get())) {
            return null;
        }
        return <style>{this.styleRules.get()}</style>;
    }
}

export { StyleBlock };
