// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { loadBadges, LoadBadgesEnv } from "@/app/store/badge";
import { VTabBar } from "@/app/tab/vtabbar";
import { VTabBarEnv } from "@/app/tab/vtabbarenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { TabBarMockEnvProvider, TabBarMockWorkspaceId } from "@/preview/mock/tabbar-mock";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

export function VTabBarPreview() {
    const [width, setWidth] = useState<number>(220);
    return (
        <TabBarMockEnvProvider>
            <VTabBarPreviewInner width={width} setWidth={setWidth} />
        </TabBarMockEnvProvider>
    );
}

type VTabBarPreviewInnerProps = {
    width: number;
    setWidth: (width: number) => void;
};

function VTabBarPreviewInner({ width, setWidth }: VTabBarPreviewInnerProps) {
    const env = useWaveEnv<VTabBarEnv>();
    const loadBadgesEnv = useWaveEnv<LoadBadgesEnv>();
    const workspace = useAtomValue(env.wos.getWaveObjectAtom<Workspace>(`workspace:${TabBarMockWorkspaceId}`));

    useEffect(() => {
        loadBadges(loadBadgesEnv);
    }, []);

    return (
        <div className="flex w-full max-w-[900px] gap-6 px-6">
            <div className="w-[300px] shrink-0 rounded-md border border-border bg-panel p-4">
                <div className="mb-3 text-xs text-muted">Width: {width}px</div>
                <input
                    type="range"
                    min={100}
                    max={400}
                    value={width}
                    onChange={(event) => setWidth(Math.max(100, Math.min(400, Number(event.target.value))))}
                    className="w-full cursor-pointer"
                />
                <p className="mt-3 text-xs text-muted">
                    Drag tabs to reorder. Names, badges, and close buttons remain single-line.
                </p>
            </div>
            <div className="h-[360px] overflow-hidden rounded-md border border-border bg-background" style={{ width }}>
                {workspace != null && <VTabBar workspace={workspace} />}
            </div>
        </div>
    );
}
VTabBarPreviewInner.displayName = "VTabBarPreviewInner";
