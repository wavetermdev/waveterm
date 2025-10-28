// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { BuilderAppPanel } from "@/builder/builder-apppanel";
import { BuilderFocusManager } from "@/builder/store/builder-focusmanager";
import { atoms } from "@/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { debounce } from "throttle-debounce";

const DefaultLayoutPercentages = {
    chat: 50,
    app: 80,
    build: 20,
};

const BuilderWorkspace = memo(() => {
    const builderId = useAtomValue(atoms.builderId);
    const [layout, setLayout] = useState<Record<string, number>>(null);
    const [isLoading, setIsLoading] = useState(true);
    const focusType = useAtomValue(BuilderFocusManager.getInstance().focusType);
    const isAppFocused = focusType === "app";

    useEffect(() => {
        const loadLayout = async () => {
            if (!builderId) {
                setLayout(DefaultLayoutPercentages);
                setIsLoading(false);
                return;
            }

            try {
                const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                    oref: `builder:${builderId}`,
                });
                if (rtInfo?.["builder:layout"]) {
                    setLayout(rtInfo["builder:layout"] as Record<string, number>);
                } else {
                    setLayout(DefaultLayoutPercentages);
                }
            } catch (error) {
                console.error("Failed to load builder layout:", error);
                setLayout(DefaultLayoutPercentages);
            } finally {
                setIsLoading(false);
            }
        };

        loadLayout();
    }, [builderId]);

    const saveLayout = useCallback(
        debounce(500, (newLayout: Record<string, number>) => {
            if (!builderId) return;

            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: `builder:${builderId}`,
                data: {
                    "builder:layout": newLayout,
                },
            }).catch((error) => {
                console.error("Failed to save builder layout:", error);
            });
        }),
        [builderId]
    );

    const handleHorizontalLayout = useCallback(
        (sizes: number[]) => {
            const newLayout = { ...layout, chat: sizes[0] };
            setLayout(newLayout);
            saveLayout(newLayout);
        },
        [layout, saveLayout]
    );

    const handleVerticalLayout = useCallback(
        (sizes: number[]) => {
            const newLayout = { ...layout, app: sizes[0], build: sizes[1] };
            setLayout(newLayout);
            saveLayout(newLayout);
        },
        [layout, saveLayout]
    );

    if (isLoading || !layout) {
        return null;
    }

    return (
        <div className="flex-1 overflow-hidden">
            <PanelGroup direction="horizontal" onLayout={handleHorizontalLayout}>
                <Panel defaultSize={layout.chat} minSize={20}>
                    <AIPanel className="w-full h-full" />
                </Panel>
                <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
                <Panel defaultSize={100 - layout.chat} minSize={20}>
                    <div
                        className={cn(
                            "flex flex-col relative h-full",
                            isAppFocused ? "border-2 border-accent" : "border-2 border-transparent"
                        )}
                        style={{
                            borderBottomRightRadius: 10,
                        }}
                    >
                        <PanelGroup direction="vertical" onLayout={handleVerticalLayout}>
                            <Panel defaultSize={layout.app} minSize={20}>
                                <BuilderAppPanel />
                            </Panel>
                            <PanelResizeHandle className="h-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
                            <Panel defaultSize={layout.build} minSize={20} maxSize={50}>
                                <div className="w-full h-full flex items-center justify-center">
                                    <span className="text-2xl">Build Panel</span>
                                </div>
                            </Panel>
                        </PanelGroup>
                    </div>
                </Panel>
            </PanelGroup>
        </div>
    );
});

BuilderWorkspace.displayName = "BuilderWorkspace";

export { BuilderWorkspace };
