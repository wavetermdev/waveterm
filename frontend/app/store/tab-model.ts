// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext } from "react";

class TabModel {
    tabId: string;

    constructor(tabId: string) {
        this.tabId = tabId;
    }
}

const tabModelCache = new Map<string, TabModel>();

function getTabModelByTabId(tabId: string): TabModel {
    let model = tabModelCache.get(tabId);
    if (model == null) {
        model = new TabModel(tabId);
        tabModelCache.set(tabId, model);
    }
    return model;
}

const TabModelContext = createContext<TabModel | undefined>(undefined);

function useTabModel(): TabModel {
    const model = useContext(TabModelContext);
    if (model == null) {
        throw new Error("useTabModel must be used within a TabModelProvider");
    }
    return model;
}

export { getTabModelByTabId, TabModel, TabModelContext, useTabModel };