// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Provider } from "jotai";
import * as rx from "rxjs";
import { clsx } from "clsx";
import { TabContent } from "@/app/tab/tab";
import { v4 as uuidv4 } from "uuid";

import "/public/style.less";

const jotaiStore = jotai.createStore();

const tabArr = [
    { name: "Tab 1", tabid: uuidv4() },
    { name: "Tab 2", tabid: uuidv4() },
    { name: "Tab 3", tabid: uuidv4() },
];

const activeTabIdAtom = jotai.atom(tabArr[0].tabid);

const App = () => {
    return (
        <Provider store={jotaiStore}>
            <AppInner />
        </Provider>
    );
};

const TabBar = () => {
    const [activeTab, setActiveTab] = jotai.useAtom(activeTabIdAtom);
    return (
        <div className="tab-bar">
            {tabArr.map((tab, idx) => {
                return (
                    <div
                        key={idx}
                        className={clsx("tab", { active: activeTab === tab.tabid })}
                        onClick={() => setActiveTab(tab.tabid)}
                    >
                        {tab.name}
                    </div>
                );
            })}
        </div>
    );
};

const Workspace = () => {
    const activeTabId = jotai.useAtomValue(activeTabIdAtom);
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
