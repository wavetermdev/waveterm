// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { loadBadges, LoadBadgesEnv } from "@/app/store/badge";
import { TabBar } from "@/app/tab/tabbar";
import { TabBarEnv } from "@/app/tab/tabbarenv";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeTabBarMockEnv, TabBarMockWorkspaceId } from "@/preview/mock/tabbar-mock";
import { MockWaveEnv } from "@/preview/mock/mockwaveenv";
import { PlatformLinux, PlatformMacOS, PlatformWindows } from "@/util/platformutil";
import { useAtom, useAtomValue } from "jotai";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

const MockConfigErrors: ConfigError[] = [
    { file: "~/.waveterm/config.json", err: 'unknown preset "bg@aurora"' },
    { file: "~/.waveterm/settings.json", err: "invalid color for tab theme" },
];

export function TabBarPreview() {
    const baseEnv = useWaveEnv();
    const envRef = useRef<MockWaveEnv>(null);
    const [platform, setPlatform] = useState<NodeJS.Platform>(PlatformMacOS);

    const tabEnv = useMemo(() => makeTabBarMockEnv(baseEnv, envRef, platform), [platform]);

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
    const [updaterStatus, setUpdaterStatus] = useAtom(env.atoms.updaterStatusAtom);
    const workspace = useAtomValue(env.wos.getWaveObjectAtom<Workspace>(`workspace:${TabBarMockWorkspaceId}`));

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
