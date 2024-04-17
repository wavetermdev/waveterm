// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { TermStyleBlock } from "@/elements";
import { For } from "tsx-control-statements/components";
import { Main } from "./main";
import "./app.less";

dayjs.extend(localizedFormat);

@mobxReact.observer
class App extends React.Component<{ children: React.ReactNode }, {}> {
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
        const termThemeOptions = GlobalModel.getTermThemeOptions();
        if (termThemeOptions == null) {
            return null;
        }
        const termTheme = GlobalModel.getTermTheme();
        const themeKey = null;

        return (
            <>
                <For index="idx" each="themeKey" of={Object.keys(termTheme)}>
                    <TermStyleBlock
                        key={themeKey}
                        themeName={termTheme[themeKey]}
                        selector={this.getSelector(themeKey)}
                    />
                </For>
                <Main />
            </>
        );
    }
}

export { App };
