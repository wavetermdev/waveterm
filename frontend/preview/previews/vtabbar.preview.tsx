// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { loadBadges, LoadBadgesEnv } from "@/app/store/badge";
import { VTabBar } from "@/app/tab/vtabbar";
import { VTabBarEnv } from "@/app/tab/vtabbarenv";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { MockWaveEnv } from "@/preview/mock/mockwaveenv";
import { makeTabBarMockEnv, TabBarMockWorkspaceId } from "@/preview/mock/tabbar-mock";
import { PlatformLinux, PlatformMacOS, PlatformWindows } from "@/util/platformutil";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

export function VTabBarPreview() {
    const baseEnv = useWaveEnv();
    const envRef = useRef<MockWaveEnv>(null);
    const [platform, setPlatform] = useState<NodeJS.Platform>(PlatformMacOS);

    const tabEnv = useMemo(() => makeTabBarMockEnv(baseEnv, envRef, platform), [platform]);

    return (
        <WaveEnvContext.Provider value={tabEnv}>
            <VTabBarPreviewInner platform={platform} setPlatform={setPlatform} />
        </WaveEnvContext.Provider>
    );
}

type VTabBarPreviewInnerProps = {
    platform: NodeJS.Platform;
    setPlatform: (platform: NodeJS.Platform) => void;
};

function VTabBarPreviewInner({ platform, setPlatform }: VTabBarPreviewInnerProps) {
    const env = useWaveEnv<VTabBarEnv>();
    const loadBadgesEnv = useWaveEnv<LoadBadgesEnv>();
    const [hideAiButton, setHideAiButton] = useState(false);
    const [isFullScreen, setIsFullScreen] = useAtom(env.atoms.isFullScreen);
    const [fullConfig, setFullConfig] = useAtom(env.atoms.fullConfigAtom);
    const [updaterStatus, setUpdaterStatus] = useAtom(env.atoms.updaterStatusAtom);
    const [width, setWidth] = useState<number>(220);
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
            },
        }));
    }, [hideAiButton, setFullConfig]);

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
                <label className="flex flex-col gap-2 text-xs text-muted">
                    <span>Width: {width}px</span>
                    <input
                        type="range"
                        min={110}
                        max={400}
                        value={width}
                        onChange={(event) => setWidth(Math.max(100, Math.min(400, Number(event.target.value))))}
                        className="cursor-pointer"
                    />
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
            </div>

            <div className="flex items-start px-6">
                <div
                    className="h-[360px] overflow-hidden rounded-md border border-border bg-background"
                    style={{ width }}
                >
                    {workspace != null && <VTabBar key={platform} workspace={workspace} />}
                </div>
            </div>
        </div>
    );
}
VTabBarPreviewInner.displayName = "VTabBarPreviewInner";
