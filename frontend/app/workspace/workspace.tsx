// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { TabContent } from "@/app/tab/tab";
import { clsx } from "clsx";
import { atoms, blockDataMap } from "@/store/global";
import { v4 as uuidv4 } from "uuid";
import { BlockService } from "@/bindings/blockservice";
import { ClientService } from "@/bindings/clientservice";
import { Workspace } from "@/gopkg/wstore";
import * as wstore from "@/gopkg/wstore";
import * as jotaiUtil from "jotai/utils";
import * as WOS from "@/store/wos";
import { CenteredLoadingDiv, CenteredDiv } from "../element/quickelems";

import "./workspace.less";

function Tab({ tabId }: { tabId: string }) {
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const [tabData, tabLoading] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    function setActiveTab(tabId: string) {
        if (tabId == null) {
            return;
        }
        WOS.SetActiveTab(tabId);
    }
    return (
        <div
            className={clsx("tab", { active: tabData != null && windowData.activetabid === tabData.oid })}
            onClick={() => setActiveTab(tabData?.oid)}
        >
            {tabData?.name ?? "..."}
        </div>
    );
}

function TabBar({ workspace, waveWindow }: { workspace: Workspace; waveWindow: WaveWindow }) {
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
    const activeTabId = windowData.activetabid;

    async function createBlock(blockDef: wstore.BlockDef) {
        const rtOpts: wstore.RuntimeOpts = new wstore.RuntimeOpts({ termsize: { rows: 25, cols: 80 } });
        const rtnBlock: wstore.Block = await BlockService.CreateBlock(blockDef, rtOpts);
        const newBlockAtom = jotai.atom(rtnBlock);
        blockDataMap.set(rtnBlock.blockid, newBlockAtom);
        addBlockIdToTab(activeTabId, rtnBlock.blockid);
    }

    async function clickTerminal() {
        const termBlockDef = new wstore.BlockDef({
            controller: "shell",
            view: "term",
        });
        createBlock(termBlockDef);
    }

    async function clickPreview(fileName: string) {
        const markdownDef = new wstore.BlockDef({
            view: "preview",
            meta: { file: fileName },
        });
        createBlock(markdownDef);
    }

    async function clickPlot() {
        const plotDef = new wstore.BlockDef({
            view: "plot",
        });
        createBlock(plotDef);
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
            <TabBar workspace={ws} waveWindow={windowData} />
            <div className="workspace-tabcontent">
                <TabContent key={windowData.workspaceid} tabId={activeTabId} />
                <Widgets />
            </div>
        </div>
    );
}

export { WorkspaceElem as Workspace };
