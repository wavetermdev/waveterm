// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { atoms, createBlock } from "@/store/global";
import * as services from "@/store/services";
import * as jotai from "jotai";
import * as React from "react";
import { CenteredDiv } from "../element/quickelems";

import "./workspace.less";

function Widgets() {
    const settingsConfig = jotai.useAtomValue(atoms.settingsConfigAtom);
    const newWidgetModalVisible = React.useState(false);
    async function clickTerminal() {
        const termBlockDef = {
            controller: "shell",
            view: "term",
        };
        createBlock(termBlockDef);
    }

    async function clickEdit() {
        const editDef: BlockDef = {
            view: "codeedit",
        };
        createBlock(editDef);
    }
    async function handleWidgetSelect(blockDef: BlockDef) {
        createBlock(blockDef);
    }

    async function handleCreateWidget(newWidget: WidgetsConfigType) {
        await services.FileService.AddWidget(newWidget);
    }

    async function handleRemoveWidget(idx: number) {
        await services.FileService.RmWidget(idx);
    }

    return (
        <div className="workspace-widgets">
            <div className="widget" onClick={() => clickTerminal()}>
                <i className="fa fa-solid fa-square-terminal fa-fw" />
            </div>
            <div className="widget" onClick={() => clickEdit()}>
                <i className="fa-sharp fa-solid fa-pen-to-square"></i>
            </div>
            {settingsConfig.widgets.map((data, idx) => (
                <div className="widget" onClick={() => handleWidgetSelect(data.blockdef)} key={`widget-${idx}`}>
                    <i className={data.icon}></i>
                </div>
            ))}
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
