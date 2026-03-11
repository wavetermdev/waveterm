// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { loadBadges, LoadBadgesEnv } from "@/app/store/badge";
import { getAtoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { TabBar } from "@/app/tab/tabbar";
import { TabBarEnv } from "@/app/tab/tabbarenv";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { applyMockEnvOverrides, MockWaveEnv } from "@/preview/mock/mockwaveenv";
import { PlatformLinux, PlatformMacOS, PlatformWindows } from "@/util/platformutil";
import { atom, useAtom, useAtomValue } from "jotai";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

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
    for (const tab of InitialTabs) {
        for (const badge of tab.badges ?? []) {
            events.push({ oref: `block:${badgeBlockId(tab.tabId, badge.badgeid)}`, badge });
        }
    }
    return events;
}

const MockWorkspaceId = "preview-workspace-1";
const InitialTabs: PreviewTabEntry[] = [
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

const MockConfigErrors: ConfigError[] = [
    { file: "~/.waveterm/config.json", err: 'unknown preset "bg@aurora"' },
    { file: "~/.waveterm/settings.json", err: "invalid color for tab theme" },
];

function makeMockWorkspace(tabIds: string[]): Workspace {
    return {
        otype: "workspace",
        oid: MockWorkspaceId,
        version: 1,
        name: "Preview Workspace",
        tabids: tabIds,
        activetabid: tabIds[1] ?? tabIds[0] ?? "",
        meta: {},
    } as Workspace;
}

export function TabBarPreview() {
    const baseEnv = useWaveEnv();
    const initialTabIds = InitialTabs.map((t) => t.tabId);
    const envRef = useRef<MockWaveEnv>(null);
    const [platform, setPlatform] = useState<NodeJS.Platform>(PlatformMacOS);

    const tabEnv = useMemo(() => {
        const mockWaveObjs: Record<string, WaveObj> = {
            [`workspace:${MockWorkspaceId}`]: makeMockWorkspace(initialTabIds),
        };
        for (const tab of InitialTabs) {
            mockWaveObjs[`tab:${tab.tabId}`] = makeTabWaveObj(tab);
        }
        const env = applyMockEnvOverrides(baseEnv, {
            tabId: InitialTabs[1].tabId,
            platform,
            mockWaveObjs,
            atoms: {
                workspaceId: atom(MockWorkspaceId),
                staticTabId: atom(InitialTabs[1].tabId),
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
                    const ws = globalStore.get(e.wos.getWaveObjectAtom<Workspace>(`workspace:${MockWorkspaceId}`));
                    e.mockSetWaveObj(`workspace:${MockWorkspaceId}`, {
                        ...ws,
                        tabids: [...(ws.tabids ?? []), newTabId],
                    });
                    globalStore.set(e.atoms.staticTabId as any, newTabId);
                },
                closeTab: (_workspaceId: string, tabId: string) => {
                    const e = envRef.current;
                    if (e == null) return Promise.resolve(false);
                    const ws = globalStore.get(e.wos.getWaveObjectAtom<Workspace>(`workspace:${MockWorkspaceId}`));
                    const newTabIds = (ws.tabids ?? []).filter((id) => id !== tabId);
                    if (newTabIds.length === 0) {
                        return Promise.resolve(false);
                    }
                    e.mockSetWaveObj(`workspace:${MockWorkspaceId}`, { ...ws, tabids: newTabIds });
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
    }, [platform]);

    return (
        <WaveEnvContext.Provider value={tabEnv}>
            <TabBarPreviewInner platform={platform} setPlatform={setPlatform} />
        </WaveEnvContext.Provider>
    );
}

type TabBarPreviewInnerProps = {
    platform: NodeJS.Platform;
    setPlatform: (platform: NodeJS.Platform) => void;
};

function TabBarPreviewInner({ platform, setPlatform }: TabBarPreviewInnerProps) {
    const env = useWaveEnv<TabBarEnv>();
    const loadBadgesEnv = useWaveEnv<LoadBadgesEnv>();
    const [showConfigErrors, setShowConfigErrors] = useState(false);
    const [hideAiButton, setHideAiButton] = useState(false);
    const [showMenuBar, setShowMenuBar] = useState(false);
    const [isFullScreen, setIsFullScreen] = useAtom(env.atoms.isFullScreen);
    const [zoomFactor, setZoomFactor] = useAtom(env.atoms.zoomFactorAtom);
    const [fullConfig, setFullConfig] = useAtom(env.atoms.fullConfigAtom);
    const [updaterStatus, setUpdaterStatus] = useAtom(getAtoms().updaterStatusAtom);
    const workspace = useAtomValue(env.wos.getWaveObjectAtom<Workspace>(`workspace:${MockWorkspaceId}`));

    useEffect(() => {
        loadBadges(loadBadgesEnv);
    }, []);

    useEffect(() => {
        setFullConfig((prev) => ({
            ...(prev ?? ({} as FullConfigType)),
            settings: {
                ...(prev?.settings ?? {}),
                "app:hideaibutton": hideAiButton,
                "window:showmenubar": showMenuBar,
            },
            configerrors: showConfigErrors ? MockConfigErrors : [],
        }));
    }, [hideAiButton, showMenuBar, setFullConfig, showConfigErrors]);

    return (
        <div className="flex w-full flex-col gap-6">
            <div className="grid gap-4 rounded-md border border-border bg-panel p-4 md:grid-cols-3 mx-6 mt-6">
                <label className="flex flex-col gap-2 text-xs text-muted">
                    <span>Platform</span>
                    <select
                        value={platform}
                        onChange={(event) => setPlatform(event.target.value as NodeJS.Platform)}
                        className="rounded border border-border bg-background px-2 py-1 text-foreground cursor-pointer"
                    >
                        <option value={PlatformMacOS}>macOS</option>
                        <option value={PlatformWindows}>Windows</option>
                        <option value={PlatformLinux}>Linux</option>
                    </select>
                </label>
                <label className="flex flex-col gap-2 text-xs text-muted">
                    <span>Updater banner</span>
                    <select
                        value={updaterStatus}
                        onChange={(event) => setUpdaterStatus(event.target.value as UpdaterStatus)}
                        className="rounded border border-border bg-background px-2 py-1 text-foreground"
                    >
                        <option value="up-to-date">Hidden</option>
                        <option value="ready">Update Available</option>
                        <option value="downloading">Downloading</option>
                        <option value="installing">Installing</option>
                        <option value="error">Error</option>
                    </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                        type="checkbox"
                        checked={showConfigErrors}
                        onChange={(event) => setShowConfigErrors(event.target.checked)}
                        className="cursor-pointer"
                    />
                    Show config error button
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                        type="checkbox"
                        checked={hideAiButton}
                        onChange={(event) => setHideAiButton(event.target.checked)}
                        className="cursor-pointer"
                    />
                    Hide Wave AI button
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                        type="checkbox"
                        checked={showMenuBar}
                        onChange={(event) => setShowMenuBar(event.target.checked)}
                        className="cursor-pointer"
                    />
                    Show menu bar
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                        type="checkbox"
                        checked={isFullScreen}
                        onChange={(event) => setIsFullScreen(event.target.checked)}
                        className="cursor-pointer"
                    />
                    Full screen
                </label>
                <label className="flex flex-col gap-2 text-xs text-muted">
                    <span>Zoom factor: {zoomFactor.toFixed(2)}</span>
                    <input
                        type="range"
                        min={0.8}
                        max={1.5}
                        step={0.05}
                        value={zoomFactor}
                        onChange={(event) => setZoomFactor(Number(event.target.value))}
                        className="cursor-pointer"
                    />
                </label>
                <div className="flex items-end text-xs text-muted">
                    Double-click a tab name to rename it. Close/add buttons and drag reordering are fully functional.
                </div>
            </div>

            <div
                className="w-full border-y border-border shadow-xl overflow-hidden"
                style={{ "--zoomfactor-inv": zoomFactor > 0 ? 1 / zoomFactor : 1 } as CSSProperties}
            >
                {workspace != null && <TabBar key={platform} workspace={workspace} />}
            </div>

            <div className="mx-6 mb-6 text-xs text-muted">
                Tabs: {workspace?.tabids?.length ?? 0} · Config errors: {fullConfig?.configerrors?.length ?? 0}
            </div>
        </div>
    );
}
TabBarPreviewInner.displayName = "TabBarPreviewInner";
