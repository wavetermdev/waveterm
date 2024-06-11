// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Workspace } from "@/app/workspace/workspace";
import { atoms, globalStore } from "@/store/global";
import * as jotai from "jotai";
import { Provider } from "jotai";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
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
            <DndProvider backend={HTML5Backend}>
                <div className="titlebar"></div>
                <Workspace />
            </DndProvider>
        </div>
    );
};

export { App };