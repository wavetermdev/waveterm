// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { fireAndForget, NullAtom } from "@/util/util";
import { atom, Atom, PrimitiveAtom } from "jotai";
import { v7 as uuidv7, version as uuidVersion } from "uuid";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";
import { waveEventSubscribeSingle } from "./wps";

export type BadgeEnv = WaveEnvSubset<{
    rpc: {
        EventPublishCommand: WaveEnv["rpc"]["EventPublishCommand"];
    };
}>;

export type LoadBadgesEnv = WaveEnvSubset<{
    rpc: {
        GetAllBadgesCommand: WaveEnv["rpc"]["GetAllBadgesCommand"];
    };
}>;

export type TabBadgesEnv = WaveEnvSubset<{
    wos: WaveEnv["wos"];
}>;

const BadgeMap = new Map<string, PrimitiveAtom<Badge>>();
const TabBadgeAtomCache = new Map<string, Atom<Badge[]>>();

function publishBadgeEvent(eventData: WaveEvent, env?: BadgeEnv) {
    if (env != null) {
        fireAndForget(() => env.rpc.EventPublishCommand(TabRpcClient, eventData));
    } else {
        fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
    }
}

function clearBadgeInternal(oref: string, env?: BadgeEnv) {
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
            clear: true,
        } as BadgeEvent,
    };
    publishBadgeEvent(eventData, env);
}

function clearBadgesForBlockOnFocus(blockId: string, env?: BadgeEnv) {
    const oref = WOS.makeORef("block", blockId);
    const badgeAtom = BadgeMap.get(oref);
    const badge = badgeAtom != null ? globalStore.get(badgeAtom) : null;
    if (badge != null && !badge.pidlinked) {
        clearBadgeInternal(oref, env);
    }
}

function clearBadgesForTabOnFocus(tabId: string, env?: BadgeEnv) {
    const oref = WOS.makeORef("tab", tabId);
    const badgeAtom = BadgeMap.get(oref);
    const badge = badgeAtom != null ? globalStore.get(badgeAtom) : null;
    if (badge != null && !badge.pidlinked) {
        clearBadgeInternal(oref, env);
    }
}

function clearAllBadges(env?: BadgeEnv) {
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [],
        data: {
            oref: "",
            clearall: true,
        } as BadgeEvent,
    };
    publishBadgeEvent(eventData, env);
}

function clearBadgesForTab(tabId: string, env?: BadgeEnv) {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tab = globalStore.get(tabAtom);
    const blockIds = (tab as Tab)?.blockids ?? [];
    for (const blockId of blockIds) {
        const oref = WOS.makeORef("block", blockId);
        const badgeAtom = BadgeMap.get(oref);
        if (badgeAtom != null && globalStore.get(badgeAtom) != null) {
            clearBadgeInternal(oref, env);
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

function getTabBadgeAtom(tabId: string, env?: TabBadgesEnv): Atom<Badge[]> {
    if (tabId == null) {
        return NullAtom as Atom<Badge[]>;
    }
    let rtn = TabBadgeAtomCache.get(tabId);
    if (rtn != null) {
        return rtn;
    }
    const tabOref = WOS.makeORef("tab", tabId);
    const tabBadgeAtom = getBadgeAtom(tabOref);
    const tabAtom = env != null ? env.wos.getWaveObjectAtom<Tab>(tabOref) : WOS.getWaveObjectAtom<Tab>(tabOref);
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
        return sortBadgesForTab(badges);
    });
    TabBadgeAtomCache.set(tabId, rtn);
    return rtn;
}

async function loadBadges(env?: LoadBadgesEnv) {
    const rpc = env != null ? env.rpc : RpcApi;
    const badges = await rpc.GetAllBadgesCommand(TabRpcClient);
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

function setBadge(blockId: string, badge: Omit<Badge, "badgeid"> & { badgeid?: string }, env?: BadgeEnv) {
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
    publishBadgeEvent(eventData, env);
}

function clearBadgeById(blockId: string, badgeId: string, env?: BadgeEnv) {
    const oref = WOS.makeORef("block", blockId);
    const eventData: WaveEvent = {
        event: "badge",
        scopes: [oref],
        data: {
            oref: oref,
            clearbyid: badgeId,
        } as BadgeEvent,
    };
    publishBadgeEvent(eventData, env);
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
            if (data.clear) {
                globalStore.set(curAtom, null);
            } else if (data.badge != null) {
                const existing = globalStore.get(curAtom);
                const candidates = existing != null ? [existing, data.badge] : [data.badge];
                globalStore.set(curAtom, sortBadges(candidates)[0]);
            }
        },
    });
}

function sortBadges(badges: Badge[]): Badge[] {
    return [...badges].sort((a, b) => {
        if (a.priority !== b.priority) {
            return b.priority - a.priority;
        }
        return b.badgeid < a.badgeid ? -1 : b.badgeid > a.badgeid ? 1 : 0;
    });
}

function sortBadgesForTab(badges: Badge[]): Badge[] {
    return [...badges].sort((a, b) => {
        if (a.priority !== b.priority) {
            return b.priority - a.priority;
        }
        return a.badgeid < b.badgeid ? -1 : a.badgeid > b.badgeid ? 1 : 0;
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
    sortBadges,
    sortBadgesForTab,
};
