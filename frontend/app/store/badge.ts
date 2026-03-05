// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, Atom, PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";
import { waveEventSubscribeSingle } from "./wps";

const TabIndicatorMap = new Map<string, PrimitiveAtom<TabIndicator>>();
const PersistentBadgeMap = new Map<string, PrimitiveAtom<Badge>>();
const TransientBadgeMap = new Map<string, PrimitiveAtom<Badge>>();

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

function setupTabIndicatorSubscription() {
    waveEventSubscribeSingle({
        eventType: "tab:indicator",
        handler: (event) => {
            setTabIndicatorInternal(event.data.tabid, event.data.indicator);
        },
    });
}

function getBadgeAtom(oref: string): Atom<Badge> {
    const persistentAtom = getPersistentBadgeAtom(oref);
    const transientAtom = getTransientBadgeAtom(oref);
    return atom((get) => {
        const persistent = get(persistentAtom);
        const transient = get(transientAtom);
        if (persistent == null) {
            return transient;
        }
        if (transient == null) {
            return persistent;
        }
        return transient.priority >= persistent.priority ? transient : persistent;
    });
}

function getPersistentBadgeAtom(oref: string): PrimitiveAtom<Badge> {
    let rtn = PersistentBadgeMap.get(oref);
    if (rtn == null) {
        rtn = atom(null) as PrimitiveAtom<Badge>;
        PersistentBadgeMap.set(oref, rtn);
    }
    return rtn;
}

function getTransientBadgeAtom(oref: string): PrimitiveAtom<Badge> {
    let rtn = TransientBadgeMap.get(oref);
    if (rtn == null) {
        rtn = atom(null) as PrimitiveAtom<Badge>;
        TransientBadgeMap.set(oref, rtn);
    }
    return rtn;
}

async function loadBadges() {
    const badges = await RpcApi.GetAllBadgesCommand(TabRpcClient);
    if (badges == null) {
        return;
    }
    for (const badgeEvent of badges) {
        if (badgeEvent.oref == null) {
            continue;
        }
        if (badgeEvent.persistent) {
            const curAtom = getPersistentBadgeAtom(badgeEvent.oref);
            globalStore.set(curAtom, badgeEvent.badge ?? null);
        } else {
            const curAtom = getTransientBadgeAtom(badgeEvent.oref);
            globalStore.set(curAtom, badgeEvent.badge ?? null);
        }
    }
}

function setupBadgesSubscription() {
    waveEventSubscribeSingle({
        eventType: "badge",
        handler: (event) => {
            const data = event.data;
            if (data?.oref == null) {
                return;
            }
            if (data.persistent) {
                const curAtom = getPersistentBadgeAtom(data.oref);
                globalStore.set(curAtom, data.clear ? null : (data.badge ?? null));
            } else {
                const curAtom = getTransientBadgeAtom(data.oref);
                globalStore.set(curAtom, data.clear ? null : (data.badge ?? null));
            }
        },
    });
}

export {
    clearAllTabIndicators,
    clearTabIndicatorFromFocus,
    getBadgeAtom,
    getPersistentBadgeAtom,
    getTabIndicatorAtom,
    getTransientBadgeAtom,
    loadBadges,
    loadTabIndicators,
    setTabIndicator,
    setupBadgesSubscription,
    setupTabIndicatorSubscription,
};
