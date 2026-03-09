// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tab, TabEnv } from "@/app/tab/tab";
import { globalStore } from "@/app/store/jotaiStore";
import { getWaveObjectAtom, makeORef, mockObjectForPreview, setObjectValue } from "@/app/store/wos";
import { WaveEnv, WaveEnvContext, useWaveEnv } from "@/app/waveenv/waveenv";
import { atom, Atom, Provider } from "jotai";
import { useEffect, useRef, useState } from "react";
import { makeMockRpc } from "../mock/mockwaveenv";

const TAB_WIDTH = 130;
const TAB_HEIGHT = 26;
const EmptyBadgeAtom = atom([] as Badge[]);
const fullConfigAtom = atom<FullConfigType>({
    settings: {},
    presets: {
        "bg@sunset": {
            "display:name": "Sunset",
            "display:order": 1,
            "bg:opacity": 0.85,
        },
        "bg@aurora": {
            "display:name": "Aurora",
            "display:order": 2,
            "bg:opacity": 0.65,
        },
    },
} as FullConfigType);

interface PreviewTabEntry {
    tabId: string;
    tabName: string;
    active: boolean;
    badges?: Badge[] | null;
    flagColor?: string | null;
}

const tabDefs: PreviewTabEntry[] = [
    { tabId: "preview-tab-1", tabName: "Terminal", active: false },
    {
        tabId: "preview-tab-2",
        tabName: "My Tab",
        active: true,
        badges: [
            { badgeid: "b2", icon: "circle-check", color: "#4ade80", priority: 3 },
            { badgeid: "b1", icon: "circle-small", color: "#fbbf24", priority: 1 },
            { badgeid: "b3", icon: "circle-small", color: "red", priority: 1 },
        ],
    },
    {
        tabId: "preview-tab-2b",
        tabName: "My Tab 2",
        active: false,
        badges: [
            { badgeid: "b2", icon: "bell", color: "#4ade80", priority: 3 },
            { badgeid: "b1", icon: "circle-small", color: "red", priority: 1 },
        ],
    },
    { tabId: "preview-tab-3", tabName: "T3", active: false, flagColor: "#4ade80" },
    {
        tabId: "preview-tab-4",
        tabName: "1 Badge",
        active: false,
        badges: [{ badgeid: "b1", icon: "circle-small", color: "#fbbf24", priority: 1 }],
        flagColor: "#fbbf24",
    },
    {
        tabId: "preview-tab-5",
        tabName: "3 Badges",
        active: false,
        badges: [
            { badgeid: "b1", icon: "circle-small", color: "#fbbf24", priority: 1 },
            { badgeid: "b2", icon: "circle-check", color: "#4ade80", priority: 3 },
            { badgeid: "b3", icon: "triangle-exclamation", color: "#f87171", priority: 2 },
            { badgeid: "b4", icon: "bell", color: "#f87171", priority: 2 },
        ],
    },
];

function makePreviewTab(entry: PreviewTabEntry): Tab {
    const meta = entry.flagColor == null ? {} : { "tab:flagcolor": entry.flagColor };
    return {
        otype: "tab",
        oid: entry.tabId,
        version: 1,
        name: entry.tabName,
        blockids: [],
        meta,
    } as Tab;
}

function makeTabEnv(baseEnv: WaveEnv): TabEnv {
    const tabs = new Map<string, Tab>();
    const badgeAtoms = new Map<string, Atom<Badge[]>>();
    for (const tabDef of tabDefs) {
        const tab = makePreviewTab(tabDef);
        const oref = makeORef("tab", tabDef.tabId);
        tabs.set(tabDef.tabId, tab);
        badgeAtoms.set(tabDef.tabId, atom(tabDef.badges ?? []));
        mockObjectForPreview(oref, tab);
        getWaveObjectAtom<Tab>(oref);
        setObjectValue(tab);
    }

    const updatePreviewTab = (tabId: string, updateFn: (tab: Tab) => Tab) => {
        const tab = tabs.get(tabId);
        if (tab == null) {
            return;
        }
        const nextTab = updateFn(tab);
        tabs.set(tabId, nextTab);
        mockObjectForPreview(makeORef("tab", tabId), nextTab);
        setObjectValue(nextTab);
    };

    return {
        ...baseEnv,
        rpc: makeMockRpc({
            ActivityCommand: () => Promise.resolve(null),
        }),
        atoms: {
            ...baseEnv.atoms,
            fullConfigAtom,
        },
        tab: {
            ...baseEnv.tab,
            getTabBadgeAtom: (tabId) => badgeAtoms.get(tabId) ?? EmptyBadgeAtom,
            updateObjectMeta: async (oref, meta) => {
                const tabId = oref.split(":")[1];
                updatePreviewTab(tabId, (tab) => {
                    const nextMeta = { ...(tab.meta ?? {}), ...meta };
                    if (nextMeta["tab:flagcolor"] == null) {
                        delete nextMeta["tab:flagcolor"];
                    }
                    return { ...tab, version: tab.version + 1, meta: nextMeta };
                });
            },
            updateTabName: async (tabId, name) => {
                updatePreviewTab(tabId, (tab) => ({ ...tab, version: tab.version + 1, name }));
            },
            recordTEvent: (event, props) => {
                console.log("[preview recordTEvent]", event, props);
            },
            refocusNode: () => {},
        },
    };
}

export function TabPreview() {
    const baseEnv = useWaveEnv();
    const envRef = useRef(makeTabEnv(baseEnv));
    const [activeTabId, setActiveTabId] = useState<string>(tabDefs.find((t) => t.active)?.tabId ?? tabDefs[0].tabId);
    const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // The real tabbar imperatively sets opacity: 1 and transform after calculating
    // tab positions. Tabs start at opacity: 0 in CSS, so we mirror that here.
    useEffect(() => {
        tabDefs.forEach((tab, index) => {
            const el = tabRefs.current[tab.tabId];
            if (el) {
                el.style.opacity = "1";
                el.style.transform = `translate3d(${index * TAB_WIDTH}px, 0, 0)`;
            }
        });
    }, []);

    return (
        <Provider store={globalStore}>
            <WaveEnvContext.Provider value={envRef.current}>
                <div style={{ position: "relative", width: TAB_WIDTH * tabDefs.length, height: TAB_HEIGHT }}>
                    {tabDefs.map((tab, index) => {
                        const activeIndex = tabDefs.findIndex((t) => t.tabId === activeTabId);
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
                                tabWidth={TAB_WIDTH}
                                isNew={false}
                                onSelect={() => setActiveTabId(tab.tabId)}
                                onClose={() => console.log("close", tab.tabId)}
                                onDragStart={() => {}}
                                onLoaded={() => {}}
                            />
                        );
                    })}
                </div>
            </WaveEnvContext.Provider>
        </Provider>
    );
}
