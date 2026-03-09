// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv, WaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { Widgets } from "@/app/workspace/widgets";
import { atom, useAtom } from "jotai";
import { useRef } from "react";
import { applyMockEnvOverrides } from "../mock/mockwaveenv";

const workspaceAtom = atom<Workspace>(null as Workspace);
const resizableHeightAtom = atom(250);

function makeMockApp(name: string, icon: string, iconcolor: string): AppInfo {
    return {
        appid: `local/${name.toLowerCase().replace(/\s+/g, "-")}`,
        modtime: 0,
        manifest: { appmeta: { title: name, shortdesc: "", icon, iconcolor }, configschema: {}, dataschema: {}, secrets: {} },
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
    "defwidget@ai": {
        icon: "sparkles",
        color: "#a78bfa",
        label: "AI",
        description: "Open Wave AI",
        "display:order": 3,
        blockdef: { meta: { view: "waveai" } },
    },
    "defwidget@files": {
        icon: "folder",
        color: "#fbbf24",
        label: "Files",
        description: "Open file browser",
        "display:order": 4,
        blockdef: { meta: { view: "preview", connection: "local" } },
    },
    "defwidget@sysinfo": {
        icon: "chart-line",
        color: "#34d399",
        label: "Sysinfo",
        description: "Open system info",
        "display:order": 5,
        blockdef: { meta: { view: "sysinfo" } },
    },
};

const fullConfigAtom = atom<FullConfigType>({ settings: {}, widgets: mockWidgets } as unknown as FullConfigType);

function makeWidgetsEnv(baseEnv: WaveEnv, isDev: boolean, hasCustomAIPresets: boolean, apps?: AppInfo[]) {
    return applyMockEnvOverrides(baseEnv, {
        isDev,
        rpc: { ListAllAppsCommand: () => Promise.resolve(apps ?? []) },
        atoms: {
            fullConfigAtom,
            workspace: workspaceAtom,
            hasCustomAIPresetsAtom: atom(hasCustomAIPresets),
        },
    });
}

function WidgetsScenario({
    label,
    isDev = false,
    hasCustomAIPresets = true,
    height,
    apps,
}: {
    label: string;
    isDev?: boolean;
    hasCustomAIPresets?: boolean;
    height?: number;
    apps?: AppInfo[];
}) {
    const baseEnv = useWaveEnv();
    const envRef = useRef<WaveEnv>(null);
    if (envRef.current == null) {
        envRef.current = makeWidgetsEnv(baseEnv, isDev, hasCustomAIPresets, apps);
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

function WidgetsResizable() {
    const [height, setHeight] = useAtom(resizableHeightAtom);
    const baseEnv = useWaveEnv();
    const envRef = useRef<WaveEnv>(null);
    if (envRef.current == null) {
        envRef.current = makeWidgetsEnv(baseEnv, true, true, mockApps);
    }

    return (
        <div className="flex flex-col gap-2 items-start">
            <div className="flex items-center gap-2 text-xs text-muted font-mono">
                <span>compact/supercompact — resizable (dev mode, height: {height}px)</span>
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

export function WidgetsPreview() {
    return (
        <div className="flex flex-col gap-8 p-6">
            <div className="flex flex-row gap-8 items-start flex-wrap">
                <WidgetsScenario label="normal (with AI presets)" height={550} />
                <WidgetsScenario label="no custom AI presets" hasCustomAIPresets={false} />
                <WidgetsScenario label="dev mode (apps button)" isDev={true} apps={mockApps} />
                <WidgetsScenario label="compact (200px)" height={200} isDev={true} apps={mockApps} />
            </div>
            <WidgetsResizable />
        </div>
    );
}

