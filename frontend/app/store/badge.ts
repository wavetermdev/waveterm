// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, NullAtom } from "@/util/util";
import { v7 as uuidv7, version as uuidVersion } from "uuid";
import { atom, Atom, PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";
import { waveEventSubscribeSingle } from "./wps";

const PersistentBadgeMap = new Map<string, PrimitiveAtom<Badge>>();
const TransientBadgeMap = new Map<string, PrimitiveAtom<Badge>>();
const BlockBadgeAtomCache = new Map<string, Atom<Badge>>();
const TabBadgeAtomCache = new Map<string, Atom<Badge[]>>();

function clearBadgeInternal(oref: string, persistent: boolean) {
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
            persistent: persistent,
            clear: true,
        } as BadgeEvent,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearTransientBadgesForBlock(blockId: string) {
    const oref = WOS.makeORef("block", blockId);
    const transientAtom = TransientBadgeMap.get(oref);
    if (transientAtom != null && globalStore.get(transientAtom) != null) {
        clearBadgeInternal(oref, false);
    }
}

function clearTransientBadgeForTab(tabId: string) {
    const oref = WOS.makeORef("tab", tabId);
    const transientAtom = TransientBadgeMap.get(oref);
    if (transientAtom != null && globalStore.get(transientAtom) != null) {
        clearBadgeInternal(oref, false);
    }
}

function clearAllBadges(persistent: boolean) {
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [],
        data: {
            oref: "",
            persistent: persistent,
            clearall: true,
        } as BadgeEvent,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearBadgesForTab(tabId: string) {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tab = globalStore.get(tabAtom);
    const blockIds = (tab as Tab)?.blockids ?? [];
    for (const blockId of blockIds) {
        const oref = WOS.makeORef("block", blockId);
        const persistentAtom = PersistentBadgeMap.get(oref);
        if (persistentAtom != null && globalStore.get(persistentAtom) != null) {
            clearBadgeInternal(oref, true);
        }
        const transientAtom = TransientBadgeMap.get(oref);
        if (transientAtom != null && globalStore.get(transientAtom) != null) {
            clearBadgeInternal(oref, false);
        }
    }
}

function getBlockBadgeAtom(blockId: string): Atom<Badge> {
    if (blockId == null) {
        return NullAtom as Atom<Badge>;
    }
    let rtn = BlockBadgeAtomCache.get(blockId);
    if (rtn != null) {
        return rtn;
    }
    const oref = WOS.makeORef("block", blockId);
    const persistentAtom = getPersistentBadgeAtom(oref);
    const transientAtom = getTransientBadgeAtom(oref);
    rtn = atom((get) => {
        const persistent = get(persistentAtom);
        const transient = get(transientAtom);
        if (persistent == null) {
            return transient;
        }
        if (transient == null) {
            return persistent;
        }
        if (transient.priority !== persistent.priority) {
            return transient.priority > persistent.priority ? transient : persistent;
        }
        return transient.badgeid >= persistent.badgeid ? transient : persistent;
    });
    BlockBadgeAtomCache.set(blockId, rtn);
    return rtn;
}

function getTabBadgeAtom(tabId: string): Atom<Badge[]> {
    if (tabId == null) {
        return NullAtom as Atom<Badge[]>;
    }
    let rtn = TabBadgeAtomCache.get(tabId);
    if (rtn != null) {
        return rtn;
    }
    const tabAtom = atom((get) => WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabId), get));
    rtn = atom((get) => {
        const tab = get(tabAtom);
        const blockIds = tab?.blockids ?? [];
        const badges: Badge[] = [];
        for (const blockId of blockIds) {
            const badge = get(getBlockBadgeAtom(blockId));
            if (badge != null) {
                badges.push(badge);
            }
        }
        badges.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return b.badgeid < a.badgeid ? -1 : b.badgeid > a.badgeid ? 1 : 0;
        });
        return badges;
    });
    TabBadgeAtomCache.set(tabId, rtn);
    return rtn;
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
    if (oref == null) {
        return NullAtom as PrimitiveAtom<Badge>;
    }
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

function setBadge(blockId: string, badge: Omit<Badge, "badgeid"> & { badgeid?: string }) {
    if (!badge.badgeid) {
        badge = { ...badge, badgeid: uuidv7() };
    } else if (uuidVersion(badge.badgeid) !== 7) {
        throw new Error(`setBadge: badgeid must be a v7 UUID, got version ${uuidVersion(badge.badgeid)}`);
    }
    const oref = WOS.makeORef("block", blockId);
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
            badge: badge,
        } as BadgeEvent,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearBadgeById(blockId: string, badgeId: string, persistent: boolean) {
    const oref = WOS.makeORef("block", blockId);
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
            persistent: persistent,
            clearbyid: badgeId,
        } as BadgeEvent,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function setupBadgesSubscription() {
    waveEventSubscribeSingle({
        eventType: "badge",
        handler: (event) => {
            const data = event.data;
            if (data?.clearall) {
                const map = data.persistent ? PersistentBadgeMap : TransientBadgeMap;
                for (const atom of map.values()) {
                    globalStore.set(atom, null);
                }
                return;
            }
            if (data?.oref == null) {
                return;
            }
            const curAtom = data.persistent
                ? getPersistentBadgeAtom(data.oref)
                : getTransientBadgeAtom(data.oref);
            if (data.clearbyid) {
                const existing = globalStore.get(curAtom);
                if (existing?.badgeid === data.clearbyid) {
                    globalStore.set(curAtom, null);
                }
                return;
            }
            globalStore.set(curAtom, data.clear ? null : (data.badge ?? null));
        },
    });
}

export {
    clearAllBadges,
    clearBadgeById,
    clearBadgesForTab,
    clearTransientBadgeForTab,
    clearTransientBadgesForBlock,
    getBlockBadgeAtom,
    getPersistentBadgeAtom,
    getTabBadgeAtom,
    getTransientBadgeAtom,
    loadBadges,
    setBadge,
    setupBadgesSubscription,
};
