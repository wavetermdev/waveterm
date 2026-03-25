// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv, WaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { Widgets } from "@/app/workspace/widgets";
import { atom, useAtom, useAtomValue } from "jotai";
import { useRef } from "react";
import { applyMockEnvOverrides } from "../mock/mockwaveenv";

const resizableHeightAtom = atom(250);
const hasConfigErrorsAtom = atom(false);
const isDevAtom = atom(true);
const mockVersionAtom = atom(0);

function makeMockApp(name: string, icon: string, iconcolor: string): AppInfo {
    return {
        appid: `local/${name.toLowerCase().replace(/\s+/g, "-")}`,
        modtime: 0,
        manifest: {
            appmeta: { title: name, shortdesc: "", icon, iconcolor },
            configschema: {},
            dataschema: {},
            secrets: {},
        },
    };
}

const mockApps: AppInfo[] = [
    makeMockApp("Weather", "cloud-sun", "#60a5fa"),
    makeMockApp("Stocks", "chart-line", "#34d399"),
    makeMockApp("Notes", "note-sticky", "#fbbf24"),
    makeMockApp("Pomodoro", "clock", "#f87171"),
    makeMockApp("GitHub PRs", "code-pull-request", "#a78bfa"),
    makeMockApp("Server Monitor", "server", "#4ade80"),
];

const mockWidgets: { [key: string]: WidgetConfigType } = {
    "defwidget@term": {
        icon: "terminal",
        color: "#4ade80",
        label: "Terminal",
        description: "Open a terminal",
        "display:order": 0,
        blockdef: { meta: { view: "term", controller: "shell" } },
    },
    "defwidget@editor": {
        icon: "code",
        color: "#60a5fa",
        label: "Editor",
        description: "Open a code editor",
        "display:order": 1,
        blockdef: { meta: { view: "codeeditor" } },
    },
    "defwidget@web": {
        icon: "globe",
        color: "#f472b6",
        label: "Web",
        description: "Open a web browser",
        "display:order": 2,
        blockdef: { meta: { view: "web", url: "https://waveterm.dev" } },
    },
    "defwidget@files": {
        icon: "folder",
        color: "#fbbf24",
        label: "Files",
        description: "Open file browser",
        "display:order": 3,
        blockdef: { meta: { view: "preview", connection: "local" } },
    },
    "defwidget@sysinfo": {
        icon: "chart-line",
        color: "#34d399",
        label: "Sysinfo",
        description: "Open system info",
        "display:order": 4,
        blockdef: { meta: { view: "sysinfo" } },
    },
};

const fullConfigAtom = atom<FullConfigType>({ settings: {}, widgets: mockWidgets } as unknown as FullConfigType);

function makeWidgetsEnv(
    baseEnv: WaveEnv,
    isDev: boolean,
    apps?: AppInfo[],
    atomOverrides?: Partial<GlobalAtomsType>
) {
    return applyMockEnvOverrides(baseEnv, {
        isDev,
        rpc: { ListAllAppsCommand: () => Promise.resolve(apps ?? []) },
        atoms: {
            fullConfigAtom,
            ...atomOverrides,
        },
    });
}

function WidgetsScenario({
    label,
    isDev = false,
    height,
    apps,
}: {
    label: string;
    isDev?: boolean;
    height?: number;
    apps?: AppInfo[];
}) {
    const baseEnv = useWaveEnv();
    const envRef = useRef<WaveEnv>(null);
    if (envRef.current == null) {
        envRef.current = makeWidgetsEnv(baseEnv, isDev, apps, {
            hasConfigErrors: hasConfigErrorsAtom,
        });
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="text-xs text-muted font-mono">{label}</div>
            <WaveEnvContext.Provider value={envRef.current}>
                <div
                    className="flex flex-row bg-panel border border-border rounded overflow-hidden"
                    style={height != null ? { height } : undefined}
                >
                    <div className="flex-1" style={{ padding: 3 }}>
                        <div className="w-full h-full border border-accent rounded-sm" />
                    </div>
                    <Widgets />
                </div>
            </WaveEnvContext.Provider>
        </div>
    );
}

function WidgetsResizable({ isDev }: { isDev: boolean }) {
    const [height, setHeight] = useAtom(resizableHeightAtom);
    const baseEnv = useWaveEnv();
    const envRef = useRef<WaveEnv>(null);
    if (envRef.current == null) {
        envRef.current = makeWidgetsEnv(baseEnv, isDev, mockApps, { hasConfigErrors: hasConfigErrorsAtom });
    }

    return (
        <div className="flex flex-col gap-2 items-start">
            <div className="flex items-center gap-2 text-xs text-muted font-mono">
                <span>compact/supercompact — resizable (height: {height}px)</span>
                <input
                    type="range"
                    min={80}
                    max={600}
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    className="cursor-pointer"
                />
            </div>
            <WaveEnvContext.Provider value={envRef.current}>
                <div
                    className="flex flex-row bg-panel border border-border rounded overflow-hidden"
                    style={{ height, width: 300 }}
                >
                    <div className="flex-1" style={{ padding: 3 }}>
                        <div className="w-full h-full border border-accent rounded-sm" />
                    </div>
                    <Widgets />
                </div>
            </WaveEnvContext.Provider>
        </div>
    );
}

function PreviewControls() {
    const [hasConfigErrors, setHasConfigErrors] = useAtom(hasConfigErrorsAtom);
    const [isDev, setIsDev] = useAtom(isDevAtom);
    const [, setMockVersion] = useAtom(mockVersionAtom);

    function applyAndBump(fn: () => void) {
        fn();
        setMockVersion((v) => v + 1);
    }

    return (
        <div className="flex items-center gap-4 text-xs text-muted font-mono">
            <span className="font-semibold">preview controls:</span>
            <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={hasConfigErrors}
                    onChange={(e) => applyAndBump(() => setHasConfigErrors(e.target.checked))}
                    className="cursor-pointer"
                />
                hasConfigErrors
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={isDev}
                    onChange={(e) => applyAndBump(() => setIsDev(e.target.checked))}
                    className="cursor-pointer"
                />
                isDev
            </label>
        </div>
    );
}

export function WidgetsPreview() {
    const isDev = useAtomValue(isDevAtom);
    const mockVersion = useAtomValue(mockVersionAtom);

    return (
        <div className="flex flex-col gap-8 p-6">
            <PreviewControls />
            <div key={mockVersion} className="flex flex-col gap-8">
                <div className="flex flex-row gap-8 items-start flex-wrap">
                    <WidgetsScenario label="normal" height={550} isDev={isDev} />
                    <WidgetsScenario label="dev mode (apps button)" height={550} isDev={isDev} apps={mockApps} />
                    <WidgetsScenario label="compact (200px)" height={200} isDev={isDev} apps={mockApps} />
                </div>
                <WidgetsResizable isDev={isDev} />
            </div>
        </div>
    );
}
