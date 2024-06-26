// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { atoms, createBlock } from "@/store/global";
import * as services from "@/store/services";
import * as util from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { CenteredDiv } from "../element/quickelems";

import "./workspace.less";

const iconRegex = /^[a-z0-9-]+$/;

const Widgets = React.memo(() => {
    const settingsConfig = jotai.useAtomValue(atoms.settingsConfigAtom);
    const newWidgetModalVisible = React.useState(false);
    async function clickTerminal() {
        const termBlockDef: BlockDef = {
            controller: "shell",
            view: "term",
        };
        createBlock(termBlockDef);
    }

    async function clickHome() {
        const editDef: BlockDef = {
            view: "preview",
            meta: {
                file: "~",
            },
        };
        createBlock(editDef);
    }
    async function clickWeb() {
        const editDef: BlockDef = {
            view: "web",
            meta: {
                url: "https://waveterm.dev/",
            },
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
        await services.FileService.RemoveWidget(idx);
    }

    function isIconValid(icon: string): boolean {
        if (util.isBlank(icon)) {
            return false;
        }
        return icon.match(iconRegex) != null;
    }

    function getIconClass(icon: string): string {
        if (!isIconValid(icon)) {
            return "fa fa-solid fa-question fa-fw";
        }
        return `fa fa-solid fa-${icon} fa-fw`;
    }

    return (
        <div className="workspace-widgets">
            <div className="widget" onClick={() => clickTerminal()}>
                <div className="widget-icon">
                    <i className="fa fa-solid fa-square-terminal fa-fw" />
                </div>
                <div className="widget-label">terminal</div>
            </div>
            <div className="widget" onClick={() => clickHome()}>
                <div className="widget-icon">
                    <i className="fa-sharp fa-solid fa-home"></i>
                </div>
                <div className="widget-label">home</div>
            </div>
            {settingsConfig.widgets.map((data, idx) => (
                <div
                    className="widget"
                    onClick={() => handleWidgetSelect(data.blockdef)}
                    key={`widget-${idx}`}
                    title={data.description || data.label}
                >
                    <div className="widget-icon" style={{ color: data.color }}>
                        <i className={getIconClass(data.icon)}></i>
                    </div>
                    {!util.isBlank(data.label) ? <div className="widget-label">{data.label}</div> : null}
                </div>
            ))}
            <div className="widget no-hover">
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
});

const WorkspaceElem = React.memo(() => {
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const activeTabId = windowData?.activetabid;
    const ws = jotai.useAtomValue(atoms.workspace);
    return (
        <div className="workspace">
            <TabBar key={ws.oid} workspace={ws} />
            <div className="workspace-tabcontent">
                {activeTabId == "" ? (
                    <CenteredDiv>No Active Tab</CenteredDiv>
                ) : (
                    <>
                        <TabContent key={activeTabId} tabId={activeTabId} />
                        <Widgets />
                    </>
                )}
            </div>
        </div>
    );
});

export { WorkspaceElem as Workspace };
