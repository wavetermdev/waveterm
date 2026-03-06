// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, NullAtom } from "@/util/util";
import { atom, Atom, PrimitiveAtom } from "jotai";
import { v7 as uuidv7, version as uuidVersion } from "uuid";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";
import { waveEventSubscribeSingle } from "./wps";

const BadgeMap = new Map<string, PrimitiveAtom<Badge>>();
const TabBadgeAtomCache = new Map<string, Atom<Badge[]>>();

function clearBadgeInternal(oref: string) {
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
            clear: true,
        } as BadgeEvent,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearBadgesForBlockOnFocus(blockId: string) {
    const oref = WOS.makeORef("block", blockId);
    const badgeAtom = BadgeMap.get(oref);
    const badge = badgeAtom != null ? globalStore.get(badgeAtom) : null;
    if (badge != null && !badge.pidlinked) {
        clearBadgeInternal(oref);
    }
}

function clearBadgesForTabOnFocus(tabId: string) {
    const oref = WOS.makeORef("tab", tabId);
    const badgeAtom = BadgeMap.get(oref);
    const badge = badgeAtom != null ? globalStore.get(badgeAtom) : null;
    if (badge != null && !badge.pidlinked) {
        clearBadgeInternal(oref);
    }
}

function clearAllBadges() {
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [],
        data: {
            oref: "",
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
        const badgeAtom = BadgeMap.get(oref);
        if (badgeAtom != null && globalStore.get(badgeAtom) != null) {
            clearBadgeInternal(oref);
        }
    }
}

function getBadgeAtom(oref: string): PrimitiveAtom<Badge> {
    if (oref == null) {
        return NullAtom as PrimitiveAtom<Badge>;
    }
    let rtn = BadgeMap.get(oref);
    if (rtn == null) {
        rtn = atom(null) as PrimitiveAtom<Badge>;
        BadgeMap.set(oref, rtn);
    }
    return rtn;
}

function getBlockBadgeAtom(blockId: string): Atom<Badge> {
    if (blockId == null) {
        return NullAtom as Atom<Badge>;
    }
    const oref = WOS.makeORef("block", blockId);
    return getBadgeAtom(oref);
}

function getTabBadgeAtom(tabId: string): Atom<Badge[]> {
    if (tabId == null) {
        return NullAtom as Atom<Badge[]>;
    }
    let rtn = TabBadgeAtomCache.get(tabId);
    if (rtn != null) {
        return rtn;
    }
    const tabOref = WOS.makeORef("tab", tabId);
    const tabBadgeAtom = getBadgeAtom(tabOref);
    const tabAtom = atom((get) => WOS.getObjectValue<Tab>(tabOref, get));
    rtn = atom((get) => {
        const tab = get(tabAtom);
        const blockIds = tab?.blockids ?? [];
        const badges: Badge[] = [];
        for (const blockId of blockIds) {
            const badge = get(getBadgeAtom(WOS.makeORef("block", blockId)));
            if (badge != null) {
                badges.push(badge);
            }
        }
        const tabBadge = get(tabBadgeAtom);
        if (tabBadge != null) {
            badges.push(tabBadge);
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

async function loadBadges() {
    const badges = await RpcApi.GetAllBadgesCommand(TabRpcClient);
    if (badges == null) {
        return;
    }
    for (const badgeEvent of badges) {
        if (badgeEvent.oref == null) {
            continue;
        }
        const curAtom = getBadgeAtom(badgeEvent.oref);
        globalStore.set(curAtom, badgeEvent.badge ?? null);
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

function clearBadgeById(blockId: string, badgeId: string) {
    const oref = WOS.makeORef("block", blockId);
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
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
                for (const atom of BadgeMap.values()) {
                    globalStore.set(atom, null);
                }
                return;
            }
            if (data?.oref == null) {
                return;
            }
            const curAtom = getBadgeAtom(data.oref);
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
    clearBadgesForBlockOnFocus,
    clearBadgesForTab,
    clearBadgesForTabOnFocus,
    getBadgeAtom,
    getBlockBadgeAtom,
    getTabBadgeAtom,
    loadBadges,
    setBadge,
    setupBadgesSubscription,
};
