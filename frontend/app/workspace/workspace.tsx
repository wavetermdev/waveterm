// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { atoms, createBlock } from "@/store/global";
import * as jotai from "jotai";
import { CenteredDiv } from "../element/quickelems";

import "./workspace.less";

function Widgets() {
    async function clickTerminal() {
        const termBlockDef = {
            controller: "shell",
            view: "term",
        };
        createBlock(termBlockDef);
    }

    async function clickPreview(fileName: string) {
        const markdownDef = {
            view: "preview",
            meta: { file: fileName },
        };
        createBlock(markdownDef);
    }

    async function clickPlot() {
        const plotDef: BlockDef = {
            view: "plot",
        };
        createBlock(plotDef);
    }

    async function clickEdit() {
        const editDef: BlockDef = {
            view: "codeedit",
        };
        createBlock(editDef);
    }

    return (
        <div className="workspace-widgets">
            <div className="widget" onClick={() => clickTerminal()}>
                <i className="fa fa-solid fa-square-terminal fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPreview("~/work/wails/thenextwave/README.md")}>
                <i className="fa fa-solid fa-files fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPreview("~/work/wails/thenextwave/go.mod")}>
                <i className="fa fa-solid fa-files fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPreview("~/work/wails/thenextwave/build/appicon.png")}>
                <i className="fa fa-solid fa-files fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPreview("~")}>
                <i className="fa fa-solid fa-files fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPlot()}>
                <i className="fa fa-solid fa-chart-simple fa-fw" />
            </div>
            <div className="widget" onClick={() => clickEdit()}>
                <i className="fa-sharp fa-solid fa-pen-to-square"></i>
            </div>
            <div className="widget no-hover">
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
}

function WorkspaceElem() {
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const activeTabId = windowData?.activetabid;
    const ws = jotai.useAtomValue(atoms.workspace);
    console.log("ws", ws);
    return (
        <div className="workspace">
            <TabBar workspace={ws} />
            <div className="workspace-tabcontent">
                {activeTabId == "" ? (
                    <CenteredDiv>No Active Tab</CenteredDiv>
                ) : (
                    <>
                        <TabContent key={windowData.workspaceid} tabId={activeTabId} />
                        <Widgets />
                    </>
                )}
            </div>
        </div>
    );
}

export { WorkspaceElem as Workspace };
