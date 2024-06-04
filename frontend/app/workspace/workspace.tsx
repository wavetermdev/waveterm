// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabContent } from "@/app/tab/tab";
import { atoms } from "@/store/global";
import * as WOS from "@/store/wos";
import { clsx } from "clsx";
import * as jotai from "jotai";
import { CenteredDiv } from "../element/quickelems";

import { LayoutTreeActionType, LayoutTreeInsertNodeAction, newLayoutNode } from "@/faraday/index";
import {
    deleteLayoutStateAtomForTab,
    getLayoutStateAtomForTab,
    useLayoutTreeStateReducerAtom,
} from "@/faraday/lib/layoutAtom";
import { useCallback, useMemo } from "react";
import "./workspace.less";

function Tab({ tabId }: { tabId: string }) {
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const [tabData, tabLoading] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    function setActiveTab() {
        WOS.SetActiveTab(tabId);
    }
    function handleCloseTab() {
        WOS.CloseTab(tabId);
        deleteLayoutStateAtomForTab(tabId);
    }
    return (
        <div
            className={clsx("tab", { active: tabData != null && windowData.activetabid === tabData.oid })}
            onClick={() => setActiveTab()}
        >
            <div className="tab-close" onClick={() => handleCloseTab()}>
                <div>
                    <i className="fa fa-solid fa-xmark" />
                </div>
            </div>
            {tabData?.name ?? "..."}
        </div>
    );
}

function TabBar({ workspace }: { workspace: Workspace }) {
    function handleAddTab() {
        const newTabName = `Tab-${workspace.tabids.length + 1}`;
        WOS.AddTabToWorkspace(newTabName, true);
    }
    const tabIds = workspace?.tabids ?? [];
    return (
        <div className="tab-bar">
            {tabIds.map((tabid, idx) => {
                return <Tab key={idx} tabId={tabid} />;
            })}
            <div className="tab-add" onClick={() => handleAddTab()}>
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
}

function Widgets() {
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const activeTabAtom = useMemo(() => {
        return WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", windowData.activetabid));
    }, [windowData.activetabid]);
    const [, dispatchLayoutStateAction] = useLayoutTreeStateReducerAtom(
        getLayoutStateAtomForTab(windowData.activetabid, activeTabAtom)
    );

    const addBlockToTab = useCallback(
        (blockId: string) => {
            const insertNodeAction: LayoutTreeInsertNodeAction<TabLayoutData> = {
                type: LayoutTreeActionType.InsertNode,
                node: newLayoutNode<TabLayoutData>(undefined, undefined, undefined, { blockId }),
            };
            dispatchLayoutStateAction(insertNodeAction);
        },
        [activeTabAtom]
    );

    async function createBlock(blockDef: BlockDef) {
        const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
        const { blockId } = await WOS.CreateBlock(blockDef, rtOpts);
        addBlockToTab(blockId);
    }

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
            <div className="widget" onClick={() => clickPreview("README.md")}>
                <i className="fa fa-solid fa-files fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPreview("go.mod")}>
                <i className="fa fa-solid fa-files fa-fw" />
            </div>
            <div className="widget" onClick={() => clickPreview("build/appicon.png")}>
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
