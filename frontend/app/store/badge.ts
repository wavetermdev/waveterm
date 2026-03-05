// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";

const TabIndicatorMap = new Map<string, PrimitiveAtom<TabIndicator>>();

function getTabIndicatorAtom(tabId: string): PrimitiveAtom<TabIndicator> {
    let rtn = TabIndicatorMap.get(tabId);
    if (rtn == null) {
        rtn = atom(null) as PrimitiveAtom<TabIndicator>;
        TabIndicatorMap.set(tabId, rtn);
    }
    return rtn;
}

function setTabIndicatorInternal(tabId: string, indicator: TabIndicator) {
    if (indicator == null) {
        const indicatorAtom = getTabIndicatorAtom(tabId);
        globalStore.set(indicatorAtom, null);
        return;
    }
    const indicatorAtom = getTabIndicatorAtom(tabId);
    const currentIndicator = globalStore.get(indicatorAtom);
    if (currentIndicator == null) {
        globalStore.set(indicatorAtom, indicator);
        return;
    }
    if (indicator.priority >= currentIndicator.priority) {
        if (indicator.clearonfocus && !currentIndicator.clearonfocus) {
            indicator.persistentindicator = currentIndicator;
        }
        globalStore.set(indicatorAtom, indicator);
    }
}

function setTabIndicator(tabId: string, indicator: TabIndicator) {
    setTabIndicatorInternal(tabId, indicator);

    const eventData: WaveEvent = {
        event: "tab:indicator",
        scopes: [WOS.makeORef("tab", tabId)],
        data: {
            tabid: tabId,
            indicator: indicator,
        },
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearTabIndicatorFromFocus(tabId: string) {
    const indicatorAtom = getTabIndicatorAtom(tabId);
    const currentIndicator = globalStore.get(indicatorAtom);
    if (currentIndicator == null) {
        return;
    }
    const persistentIndicator = currentIndicator.persistentindicator;
    const eventData: WaveEvent = {
        event: "tab:indicator",
        scopes: [WOS.makeORef("tab", tabId)],
        data: {
            tabid: tabId,
            indicator: persistentIndicator ?? null,
        } as TabIndicatorEventData,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearAllTabIndicators() {
    for (const [tabId, indicatorAtom] of TabIndicatorMap.entries()) {
        const indicator = globalStore.get(indicatorAtom);
        if (indicator != null) {
            setTabIndicator(tabId, null);
        }
    }
}

async function loadTabIndicators() {
    const tabIndicators = await RpcApi.GetAllTabIndicatorsCommand(TabRpcClient);
    if (tabIndicators == null) {
        return;
    }
    for (const [tabId, indicator] of Object.entries(tabIndicators)) {
        const curAtom = getTabIndicatorAtom(tabId);
        globalStore.set(curAtom, indicator);
    }
}

export {
    clearAllTabIndicators,
    clearTabIndicatorFromFocus,
    getTabIndicatorAtom,
    loadTabIndicators,
    setTabIndicator,
    setTabIndicatorInternal,
};
