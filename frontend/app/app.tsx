// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Provider } from "jotai";
import { clsx } from "clsx";
import { Workspace } from "@/app/workspace/workspace";
import { globalStore, atoms } from "@/store/global";

import "../../public/style.less";
import { CenteredDiv } from "./element/quickelems";

const App = () => {
    return (
        <Provider store={globalStore}>
            <AppInner />
        </Provider>
    );
};

const AppInner = () => {
    const client = jotai.useAtomValue(atoms.client);
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    if (client == null || windowData == null) {
        return (
            <div className="mainapp">
                <div className="titlebar"></div>
                <CenteredDiv>invalid configuration, client or window was not loaded</CenteredDiv>
            </div>
        );
    }
    return (
        <div className="mainapp">
            <div className="titlebar"></div>
            <Workspace />
        </div>
    );
};

export { App };
