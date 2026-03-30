// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { useWaveEnv, WaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { applyMockEnvOverrides, MockWaveEnv } from "@/preview/mock/mockwaveenv";
import { PlatformMacOS } from "@/util/platformutil";
import { atom } from "jotai";
import React, { useMemo, useRef } from "react";

type PreviewTabEntry = {
    tabId: string;
    tabName: string;
    badges?: Badge[] | null;
    flagColor?: string | null;
};

function badgeBlockId(tabId: string, badgeId: string): string {
    return `${tabId}-badge-${badgeId}`;
}

function makeTabWaveObj(tab: PreviewTabEntry): Tab {
    const blockids = (tab.badges ?? []).map((b) => badgeBlockId(tab.tabId, b.badgeid));
    return {
        otype: "tab",
        oid: tab.tabId,
        version: 1,
        name: tab.tabName,
        blockids,
        meta: tab.flagColor ? { "tab:flagcolor": tab.flagColor } : {},
    } as Tab;
}

function makeMockBadgeEvents(): BadgeEvent[] {
    const events: BadgeEvent[] = [];
    for (const tab of TabBarMockTabs) {
        for (const badge of tab.badges ?? []) {
            events.push({ oref: `block:${badgeBlockId(tab.tabId, badge.badgeid)}`, badge });
        }
    }
    return events;
}

export const TabBarMockWorkspaceId = "preview-workspace-1";

export const TabBarMockTabs: PreviewTabEntry[] = [
    { tabId: "preview-tab-1", tabName: "Terminal" },
    {
        tabId: "preview-tab-2",
        tabName: "Build Logs",
        badges: [
            {
                badgeid: "01958000-0000-7000-0000-000000000001",
                icon: "triangle-exclamation",
                color: "#f59e0b",
                priority: 2,
            },
        ],
    },
    {
        tabId: "preview-tab-3",
        tabName: "Deploy",
        badges: [
            { badgeid: "01958000-0000-7000-0000-000000000002", icon: "circle-check", color: "#4ade80", priority: 3 },
        ],
        flagColor: "#429dff",
    },
    {
        tabId: "preview-tab-4",
        tabName: "A Very Long Tab Name To Show Truncation",
        badges: [
            { badgeid: "01958000-0000-7000-0000-000000000003", icon: "bell", color: "#f87171", priority: 2 },
            { badgeid: "01958000-0000-7000-0000-000000000004", icon: "circle-small", color: "#fbbf24", priority: 1 },
        ],
    },
    { tabId: "preview-tab-5", tabName: "Wave AI" },
    { tabId: "preview-tab-6", tabName: "Preview", flagColor: "#bf55ec" },
];

function makeMockWorkspace(tabIds: string[]): Workspace {
    return {
        otype: "workspace",
        oid: TabBarMockWorkspaceId,
        version: 1,
        name: "Preview Workspace",
        tabids: tabIds,
        activetabid: tabIds[1] ?? tabIds[0] ?? "",
        meta: {},
    } as Workspace;
}

export function makeTabBarMockEnv(
    baseEnv: WaveEnv,
    envRef: React.RefObject<MockWaveEnv>,
    platform: NodeJS.Platform
): MockWaveEnv {
    const initialTabIds = TabBarMockTabs.map((t) => t.tabId);
    const mockWaveObjs: Record<string, WaveObj> = {
        [`workspace:${TabBarMockWorkspaceId}`]: makeMockWorkspace(initialTabIds),
    };
    for (const tab of TabBarMockTabs) {
        mockWaveObjs[`tab:${tab.tabId}`] = makeTabWaveObj(tab);
    }
    const env = applyMockEnvOverrides(baseEnv, {
        tabId: TabBarMockTabs[1].tabId,
        platform,
        mockWaveObjs,
        atoms: {
            workspaceId: atom(TabBarMockWorkspaceId),
            staticTabId: atom(TabBarMockTabs[1].tabId),
        },
        rpc: {
            GetAllBadgesCommand: () => Promise.resolve(makeMockBadgeEvents()),
        },
        electron: {
            createTab: () => {
                const e = envRef.current;
                if (e == null) return;
                const newTabId = `preview-tab-${crypto.randomUUID()}`;
                e.mockSetWaveObj(`tab:${newTabId}`, {
                    otype: "tab",
                    oid: newTabId,
                    version: 1,
                    name: "New Tab",
                    blockids: [],
                    meta: {},
                } as Tab);
                const ws = globalStore.get(e.wos.getWaveObjectAtom<Workspace>(`workspace:${TabBarMockWorkspaceId}`));
                e.mockSetWaveObj(`workspace:${TabBarMockWorkspaceId}`, {
                    ...ws,
                    tabids: [...(ws.tabids ?? []), newTabId],
                });
                globalStore.set(e.atoms.staticTabId as any, newTabId);
            },
            closeTab: (_workspaceId: string, tabId: string) => {
                const e = envRef.current;
                if (e == null) return Promise.resolve(false);
                const ws = globalStore.get(e.wos.getWaveObjectAtom<Workspace>(`workspace:${TabBarMockWorkspaceId}`));
                const newTabIds = (ws.tabids ?? []).filter((id) => id !== tabId);
                if (newTabIds.length === 0) {
                    return Promise.resolve(false);
                }
                e.mockSetWaveObj(`workspace:${TabBarMockWorkspaceId}`, { ...ws, tabids: newTabIds });
                if (globalStore.get(e.atoms.staticTabId) === tabId) {
                    globalStore.set(e.atoms.staticTabId as any, newTabIds[0]);
                }
                return Promise.resolve(true);
            },
            setActiveTab: (tabId: string) => {
                const e = envRef.current;
                if (e == null) return;
                globalStore.set(e.atoms.staticTabId as any, tabId);
            },
            showWorkspaceAppMenu: () => {
                console.log("[preview] showWorkspaceAppMenu");
            },
        },
    });
    envRef.current = env;
    return env;
}

type TabBarMockEnvProviderProps = {
    children: React.ReactNode;
};

export function TabBarMockEnvProvider({ children }: TabBarMockEnvProviderProps) {
    const baseEnv = useWaveEnv();
    const envRef = useRef<MockWaveEnv>(null);
    const tabEnv = useMemo(() => makeTabBarMockEnv(baseEnv, envRef, PlatformMacOS), []);
    return <WaveEnvContext.Provider value={tabEnv}>{children}</WaveEnvContext.Provider>;
}
TabBarMockEnvProvider.displayName = "TabBarMockEnvProvider";
