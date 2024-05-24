// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { TabContent } from "@/app/tab/tab";
import { clsx } from "clsx";
import { atoms, addBlockIdToTab, blockDataMap } from "@/store/global";
import { v4 as uuidv4 } from "uuid";
import { BlockService } from "@/bindings/blockservice";
import { ClientService } from "@/bindings/clientservice";
import { Workspace } from "@/gopkg/wstore";
import * as wstore from "@/gopkg/wstore";
import * as jotaiUtil from "jotai/utils";

import "./workspace.less";
import { CenteredLoadingDiv, CenteredDiv } from "../element/quickelems";

function Tab({ tab }: { tab: wstore.Tab }) {
    const [activeTab, setActiveTab] = jotai.useAtom(atoms.activeTabId);
    return (
        <div className={clsx("tab", { active: activeTab === tab.tabid })} onClick={() => setActiveTab(tab.tabid)}>
            {tab.name}
        </div>
    );
}

function TabBar() {
    const [tabData, setTabData] = jotai.useAtom(atoms.tabsAtom);
    const [activeTab, setActiveTab] = jotai.useAtom(atoms.activeTabId);
    const tabs = jotai.useAtomValue(atoms.tabsAtom);
    const client = jotai.useAtomValue(atoms.clientAtom);

    function handleAddTab() {
        const newTabId = uuidv4();
        const newTabName = "Tab " + (tabData.length + 1);
        setTabData([...tabData, { name: newTabName, tabid: newTabId, blockids: [] }]);
        setActiveTab(newTabId);
    }

    return (
        <div className="tab-bar">
            {tabs.map((tab, idx) => {
                return <Tab key={idx} tab={tab} />;
            })}
            <div className="tab-add" onClick={() => handleAddTab()}>
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
}

function Widgets() {
    const activeTabId = jotai.useAtomValue(atoms.activeTabId);

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
    const windowData = jotai.useAtomValue(atoms.windowData);
    const activeTabId = jotai.useAtomValue(atoms.activeTabId);
    const workspaceId = windowData.workspaceid;
    const wsAtom = React.useMemo(() => {
        return jotaiUtil.loadable(
            jotai.atom(async (get) => {
                const ws = await ClientService.GetWorkspace(workspaceId);
                return ws;
            })
        );
    }, [workspaceId]);
    const wsLoadable = jotai.useAtomValue(wsAtom);
    if (wsLoadable.state === "loading") {
        return <CenteredLoadingDiv />;
    }
    if (wsLoadable.state === "hasError") {
        return <CenteredDiv>Error: {wsLoadable.error?.toString()}</CenteredDiv>;
    }
    const ws: Workspace = wsLoadable.data;
    return (
        <div className="workspace">
            <TabBar />
            <div className="workspace-tabcontent">
                <TabContent key={workspaceId} tabId={activeTabId} />
                <Widgets />
            </div>
        </div>
    );
}

export { WorkspaceElem as Workspace };
