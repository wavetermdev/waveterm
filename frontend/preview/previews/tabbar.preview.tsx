// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import WorkspaceSVG from "@/app/asset/workspace.svg";
import { IconButton } from "@/app/element/iconbutton";
import { Tooltip } from "@/app/element/tooltip";
import { loadBadges, LoadBadgesEnv } from "@/app/store/badge";
import { getAtoms } from "@/app/store/global-atoms";
import { Tab } from "@/app/tab/tab";
import { ConfigErrorIcon, WaveAIButton } from "@/app/tab/tabbar";
import { TabBarEnv } from "@/app/tab/tabbarenv";
import { UpdateStatusBanner } from "@/app/tab/updatebanner";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { applyMockEnvOverrides } from "@/preview/mock/mockwaveenv";
import { useAtom } from "jotai";
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

const TabDefaultWidth = 130;
const TabMinWidth = 100;
const TabHeight = 26;
const MockWorkspaceSwitcherWidth = 42;
const MockAddTabButtonWidth = 44;
const MockConfigErrors: ConfigError[] = [
    { file: "~/.waveterm/config.json", err: 'unknown preset "bg@aurora"' },
    { file: "~/.waveterm/settings.json", err: "invalid color for tab theme" },
];
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

function shouldShowAppMenuButton(platform: NodeJS.Platform, showMenuBar: boolean): boolean {
    return platform === "win32" || (platform !== "darwin" && !showMenuBar);
}

function getWindowDragWidths(platform: NodeJS.Platform, isFullScreen: boolean, zoomFactor: number) {
    let windowDragLeftWidth = 10;
    if (platform === "darwin" && !isFullScreen) {
        windowDragLeftWidth = zoomFactor > 0 ? 74 / zoomFactor : 74;
    }

    let windowDragRightWidth = 12;
    if (platform === "win32") {
        windowDragRightWidth = zoomFactor > 0 ? 139 / zoomFactor : 139;
    }

    return { windowDragLeftWidth, windowDragRightWidth };
}

function MockWorkspaceSwitcher({ divRef }: { divRef: React.RefObject<HTMLDivElement> }) {
    return (
        <Tooltip
            content="Workspace Switcher"
            placement="bottom"
            hideOnClick
            divRef={divRef}
            divClassName="flex items-center"
        >
            <div
                className="mb-1 mr-1 flex h-[22px] w-[28px] items-center justify-center rounded-md bg-hover text-secondary"
                style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
                <WorkspaceSVG className="h-[13px] w-[13px]" />
            </div>
        </Tooltip>
    );
}

function MockTabStrip({
    tabs,
    activeTabId,
    availableWidth,
    onSelectTab,
    onCloseTab,
}: {
    tabs: PreviewTabEntry[];
    activeTabId: string;
    availableWidth: number;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
}) {
    const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const tabWidth = useMemo(() => {
        if (tabs.length === 0) {
            return TabDefaultWidth;
        }
        return Math.max(TabMinWidth, Math.min(availableWidth / tabs.length, TabDefaultWidth));
    }, [availableWidth, tabs.length]);

    useEffect(() => {
        tabs.forEach((tab, index) => {
            const el = tabRefs.current[tab.tabId];
            if (el == null) {
                return;
            }
            el.style.width = `${tabWidth}px`;
            el.style.opacity = "1";
            el.style.transform = `translate3d(${index * tabWidth}px, 0, 0)`;
        });
    }, [tabWidth, tabs]);

    return (
        <div className="tabs-wrapper" style={{ width: `${tabs.length * tabWidth}px` }}>
            <div style={{ position: "relative", width: tabs.length * tabWidth, height: TabHeight }}>
                {tabs.map((tab, index) => {
                    const activeIndex = tabs.findIndex((item) => item.tabId === activeTabId);
                    const isActive = tab.tabId === activeTabId;
                    const showDivider = index !== 0 && !isActive && index !== activeIndex + 1;
                    return (
                        <Tab
                            key={tab.tabId}
                            ref={(el) => {
                                tabRefs.current[tab.tabId] = el;
                            }}
                            id={tab.tabId}
                            active={isActive}
                            showDivider={showDivider}
                            isDragging={false}
                            tabWidth={tabWidth}
                            isNew={false}
                            onSelect={() => onSelectTab(tab.tabId)}
                            onClose={() => onCloseTab(tab.tabId)}
                            onDragStart={() => {}}
                            onLoaded={() => {}}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export function TabBarPreview() {
    const baseEnv = useWaveEnv();
    const tabEnv = useMemo(() => {
        const mockWaveObjs = Object.fromEntries(InitialTabs.map((tab) => [`tab:${tab.tabId}`, makeTabWaveObj(tab)]));
        return applyMockEnvOverrides(baseEnv, {
            mockWaveObjs,
            rpc: {
                GetAllBadgesCommand: () => Promise.resolve(makeMockBadgeEvents()),
            },
        });
    }, []);
    return (
        <WaveEnvContext.Provider value={tabEnv}>
            <TabBarPreviewInner />
        </WaveEnvContext.Provider>
    );
}

function TabBarPreviewInner() {
    const env = useWaveEnv<TabBarEnv>();
    const loadBadgesEnv = useWaveEnv<LoadBadgesEnv>();
    const [tabs, setTabs] = useState<PreviewTabEntry[]>(InitialTabs);
    const [activeTabId, setActiveTabId] = useState<string>(InitialTabs[1].tabId);
    const [frameWidth, setFrameWidth] = useState(1180);
    const [platform, setPlatform] = useState<NodeJS.Platform>("darwin");
    const [showMenuBar, setShowMenuBar] = useState(false);
    const [showConfigErrors, setShowConfigErrors] = useState(true);
    const [hideAiButton, setHideAiButton] = useState(false);
    const [isFullScreen, setIsFullScreen] = useAtom(env.atoms.isFullScreen);
    const [zoomFactor, setZoomFactor] = useAtom(env.atoms.zoomFactorAtom);
    const [fullConfig, setFullConfig] = useAtom(env.atoms.fullConfigAtom);
    const [updaterStatus, setUpdaterStatus] = useAtom(getAtoms().updaterStatusAtom);
    const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
    const waveAIButtonRef = useRef<HTMLDivElement>(null);
    const updateStatusBannerRef = useRef<HTMLButtonElement>(null);
    const configErrorButtonRef = useRef<HTMLElement>(null);

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
    }, [hideAiButton, setFullConfig, showConfigErrors, showMenuBar]);

    const showAppMenuButton = shouldShowAppMenuButton(platform, showMenuBar);
    const { windowDragLeftWidth, windowDragRightWidth } = getWindowDragWidths(platform, isFullScreen, zoomFactor);
    const tabsAvailableWidth =
        frameWidth -
        windowDragLeftWidth -
        windowDragRightWidth -
        (showAppMenuButton ? 28 : 0) -
        (hideAiButton ? 0 : 48) -
        MockWorkspaceSwitcherWidth -
        MockAddTabButtonWidth -
        (updaterStatus === "up-to-date" ? 0 : 164) -
        (showConfigErrors ? 132 : 0) -
        24;

    return (
        <div className="flex w-full max-w-[1500px] flex-col gap-6 p-6">
            <div className="grid gap-4 rounded-md border border-border bg-panel p-4 md:grid-cols-3">
                <label className="flex flex-col gap-2 text-xs text-muted">
                    <span>Frame width: {frameWidth}px</span>
                    <input
                        type="range"
                        min={760}
                        max={1480}
                        value={frameWidth}
                        onChange={(event) => setFrameWidth(Number(event.target.value))}
                        className="cursor-pointer"
                    />
                </label>
                <label className="flex flex-col gap-2 text-xs text-muted">
                    <span>Platform</span>
                    <select
                        value={platform}
                        onChange={(event) => setPlatform(event.target.value as NodeJS.Platform)}
                        className="rounded border border-border bg-background px-2 py-1 text-foreground"
                    >
                        <option value="darwin">macOS</option>
                        <option value="win32">Windows</option>
                        <option value="linux">Linux</option>
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
                        checked={showMenuBar}
                        onChange={(event) => setShowMenuBar(event.target.checked)}
                        className="cursor-pointer"
                    />
                    Show menu bar
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
                    Double-click a tab name to rename it. Close buttons and context menus are mocked for preview use.
                </div>
            </div>

            <div
                className="overflow-hidden rounded-md border border-border shadow-xl"
                style={
                    {
                        width: frameWidth,
                        "--zoomfactor-inv": zoomFactor > 0 ? 1 / zoomFactor : 1,
                    } as CSSProperties
                }
            >
                <div className="tab-bar-wrapper">
                    <div
                        className="h-full shrink-0 z-window-drag"
                        style={{ width: windowDragLeftWidth, WebkitAppRegion: "drag" } as CSSProperties}
                    />
                    {showAppMenuButton && (
                        <div
                            className="flex items-center justify-center pr-1.5 text-[26px] select-none cursor-pointer text-secondary hover:text-primary"
                            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
                        >
                            <i className="fa fa-ellipsis" />
                        </div>
                    )}
                    <WaveAIButton divRef={waveAIButtonRef} />
                    <MockWorkspaceSwitcher divRef={workspaceSwitcherRef} />
                    <div className="tab-bar">
                        <MockTabStrip
                            tabs={tabs}
                            activeTabId={activeTabId}
                            availableWidth={Math.max(tabsAvailableWidth, TabMinWidth)}
                            onSelectTab={setActiveTabId}
                            onCloseTab={(tabId) => {
                                setTabs((prevTabs) => {
                                    const nextTabs = prevTabs.filter((tab) => tab.tabId !== tabId);
                                    if (nextTabs.length === 0) {
                                        return prevTabs;
                                    }
                                    if (activeTabId === tabId) {
                                        setActiveTabId(nextTabs[0].tabId);
                                    }
                                    return nextTabs;
                                });
                            }}
                        />
                    </div>
                    <IconButton
                        className="add-tab"
                        decl={{
                            elemtype: "iconbutton",
                            icon: "plus",
                            title: "Add Tab",
                            click: () => {
                                const previewTabId = `preview-tab-${crypto.randomUUID()}`;
                                const nextTab = { tabId: previewTabId, tabName: "New Tab" };
                                setTabs((prevTabs) => [...prevTabs, nextTab]);
                                setActiveTabId(previewTabId);
                            },
                        }}
                    />
                    <div className="tab-bar-right">
                        <UpdateStatusBanner ref={updateStatusBannerRef} />
                        <ConfigErrorIcon buttonRef={configErrorButtonRef} />
                        <div
                            className="h-full shrink-0 z-window-drag"
                            style={{ width: windowDragRightWidth, WebkitAppRegion: "drag" } as CSSProperties}
                        />
                    </div>
                </div>
            </div>

            <div className="text-xs text-muted">
                Tabs: {tabs.length} · Active tab: {activeTabId} · Config errors: {fullConfig?.configerrors?.length ?? 0}
            </div>
        </div>
    );
}
TabBarPreviewInner.displayName = "TabBarPreviewInner";
