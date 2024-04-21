// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { TermStyleList } from "@/elements";
import { If } from "tsx-control-statements/components";
import { Main } from "./main";

import "./app.less";

dayjs.extend(localizedFormat);

@mobxReact.observer
class App extends React.Component<{}, {}> {
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
        const termThemeOptions = GlobalModel.getTermThemes();
        if (termThemeOptions == null) {
            return null;
        }
        return (
            <TermStyleList>
                {(termStylesRendered) => {
                    return (
                        <If condition={termStylesRendered}>
                            <Main />
                        </If>
                    );
                }}
            </TermStyleList>
        );
    }
}

export { App };
