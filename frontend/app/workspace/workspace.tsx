// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { TabContent } from "@/app/tab/tab";
import { clsx } from "clsx";
import { atoms, addBlockIdToTab, blockDataMap } from "@/store/global";
import { v4 as uuidv4 } from "uuid";
import * as BlockService from "@/bindings/pkg/service/blockservice/BlockService";

import "./workspace.less";

function Tab({ tab }: { tab: TabData }) {
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

    function handleAddTab() {
        const newTabId = uuidv4();
        const newTabName = "Tab " + (tabData.length + 1);
        setTabData([...tabData, { name: newTabName, tabid: newTabId, blockIds: [] }]);
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

    async function createBlock(blockDef: BlockDef) {
        const rtOpts = { termsize: { rows: 25, cols: 80 } };
        const rtnBlock: BlockData = await BlockService.CreateBlock(blockDef, rtOpts);
        const newBlockAtom = jotai.atom(rtnBlock);
        blockDataMap.set(rtnBlock.blockid, newBlockAtom);
        addBlockIdToTab(activeTabId, rtnBlock.blockid);
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
        const plotDef = {
            view: "plot",
        };
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
            <div className="widget" onClick={() => clickPlot()}>
                <i className="fa fa-solid fa-chart-simple fa-fw" />
            </div>
            <div className="widget no-hover">
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
}

function Workspace() {
    const activeTabId = jotai.useAtomValue(atoms.activeTabId);
    return (
        <div className="workspace">
            <TabBar />
            <div className="workspace-tabcontent">
                <TabContent key={activeTabId} tabId={activeTabId} />
                <Widgets />
            </div>
        </div>
    );
}

export { Workspace };
