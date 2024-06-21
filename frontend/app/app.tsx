// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Workspace } from "@/app/workspace/workspace";
import { atoms, getApi, globalStore } from "@/store/global";
import * as util from "@/util/util";
import * as jotai from "jotai";
import { Provider } from "jotai";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { CenteredDiv } from "./element/quickelems";

import "overlayscrollbars/overlayscrollbars.css";
import "./app.less";

const App = () => {
    return (
        <Provider store={globalStore}>
            <AppInner />
        </Provider>
    );
};

function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    let isInNonTermInput = false;
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem.nodeName == "TEXTAREA") {
        if (!activeElem.classList.contains("xterm-helper-textarea")) {
            isInNonTermInput = true;
        }
    }
    if (activeElem != null && activeElem.nodeName == "INPUT" && activeElem.getAttribute("type") == "text") {
        isInNonTermInput = true;
    }
    const opts: ContextMenuOpts = {};
    if (isInNonTermInput) {
        opts.showCut = true;
    }
    const sel = window.getSelection();
    if (!util.isBlank(sel?.toString()) || isInNonTermInput) {
        getApi().contextEditMenu({ x: e.clientX, y: e.clientY }, opts);
    } else {
        getApi().contextEditMenu({ x: e.clientX, y: e.clientY }, { onlyPaste: true });
    }
}

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
        <div className="mainapp" onContextMenu={handleContextMenu}>
            <DndProvider backend={HTML5Backend}>
                <div className="titlebar"></div>
                <Workspace />
            </DndProvider>
        </div>
    );
};

export { App };
