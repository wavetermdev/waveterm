// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Provider } from "jotai";
import { clsx } from "clsx";
import { TabContent } from "@/app/tab/tab";
import { globalStore, atoms } from "@/store/global";

import "/public/style.less";

const App = () => {
    return (
        <Provider store={globalStore}>
            <AppInner />
        </Provider>
    );
};

const Tab = ({ tab }: { tab: TabData }) => {
    const [activeTab, setActiveTab] = jotai.useAtom(atoms.activeTabId);
    return (
        <div className={clsx("tab", { active: activeTab === tab.tabid })} onClick={() => setActiveTab(tab.tabid)}>
            {tab.name}
        </div>
    );
};

const TabBar = () => {
    const [activeTab, setActiveTab] = jotai.useAtom(atoms.activeTabId);
    const tabs = jotai.useAtomValue(atoms.tabsAtom);
    return (
        <div className="tab-bar">
            {tabs.map((tab, idx) => {
                return <Tab key={idx} tab={tab} />;
            })}
        </div>
    );
};

const Workspace = () => {
    const activeTabId = jotai.useAtomValue(atoms.activeTabId);
    return (
        <div className="workspace">
            <TabBar />
            <TabContent tabId={activeTabId} />
        </div>
    );
};

const AppInner = () => {
    return (
        <div className="mainapp">
            <div className="titlebar"></div>
            <Workspace />
        </div>
    );
};

export { App };
