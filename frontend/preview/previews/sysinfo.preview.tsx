// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { handleWaveEvent } from "@/app/store/wps";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import type { NodeModel } from "@/layout/index";
import { atom } from "jotai";
import * as React from "react";
import { applyMockEnvOverrides, MockWaveEnv } from "../mock/mockwaveenv";
import {
    DefaultSysinfoHistoryPoints,
    makeMockSysinfoEvent,
    makeMockSysinfoHistory,
    MockSysinfoConnection,
} from "./sysinfo.preview-util";

const PreviewWorkspaceId = "preview-sysinfo-workspace";
const PreviewTabId = "preview-sysinfo-tab";
const PreviewNodeId = "preview-sysinfo-node";
const PreviewBlockId = "preview-sysinfo-block";

function makeMockBlock(): Block {
    return {
        otype: "block",
        oid: PreviewBlockId,
        version: 1,
        meta: {
            view: "sysinfo",
            connection: MockSysinfoConnection,
            "sysinfo:type": "CPU + Mem",
            "graph:numpoints": 90,
        },
    } as Block;
}

function makePreviewNodeModel(): NodeModel {
    const isFocusedAtom = atom(true);
    const isMagnifiedAtom = atom(false);

    return {
        additionalProps: atom({} as any),
        innerRect: atom({ width: "920px", height: "560px" }),
        blockNum: atom(1),
        numLeafs: atom(2),
        nodeId: PreviewNodeId,
        blockId: PreviewBlockId,
        addEphemeralNodeToLayout: () => {},
        animationTimeS: atom(0),
        isResizing: atom(false),
        isFocused: isFocusedAtom,
        isMagnified: isMagnifiedAtom,
        anyMagnified: atom(false),
        isEphemeral: atom(false),
        ready: atom(true),
        disablePointerEvents: atom(false),
        toggleMagnify: () => {
            globalStore.set(isMagnifiedAtom, !globalStore.get(isMagnifiedAtom));
        },
        focusNode: () => {
            globalStore.set(isFocusedAtom, true);
        },
        onClose: () => {},
        dragHandleRef: { current: null },
        displayContainerRef: { current: null },
    };
}

function SysinfoPreviewInner() {
    const baseEnv = useWaveEnv();
    const historyRef = React.useRef(makeMockSysinfoHistory());
    const nodeModel = React.useMemo(() => makePreviewNodeModel(), []);

    const env = React.useMemo<MockWaveEnv>(() => {
        return applyMockEnvOverrides(baseEnv, {
            tabId: PreviewTabId,
            mockWaveObjs: {
                [`block:${PreviewBlockId}`]: makeMockBlock(),
            },
            atoms: {
                workspaceId: atom(PreviewWorkspaceId),
                staticTabId: atom(PreviewTabId),
            },
            rpc: {
                EventReadHistoryCommand: async (_client, data) => {
                    if (data.event !== "sysinfo" || data.scope !== MockSysinfoConnection) {
                        return [];
                    }
                    const maxItems = data.maxitems ?? historyRef.current.length;
                    return historyRef.current.slice(-maxItems);
                },
            },
        });
    }, [baseEnv]);

    const tabModel = React.useMemo(() => getTabModelByTabId(PreviewTabId, env), [env]);

    React.useEffect(() => {
        let nextStep = historyRef.current.length;
        let nextTs = (historyRef.current[historyRef.current.length - 1]?.data?.ts ?? Date.now()) + 1000;
        const intervalId = window.setInterval(() => {
            const nextEvent = makeMockSysinfoEvent(nextTs, nextStep);
            historyRef.current = [...historyRef.current.slice(-(DefaultSysinfoHistoryPoints - 1)), nextEvent];
            handleWaveEvent(nextEvent);
            nextStep++;
            nextTs += 1000;
        }, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <WaveEnvContext.Provider value={env}>
            <TabModelContext.Provider value={tabModel}>
                <div className="flex w-full max-w-[980px] flex-col gap-2 px-6 py-6">
                    <div className="text-xs text-muted font-mono">full sysinfo block (mock WOS + FE-only WPS events)</div>
                    <div className="rounded-md border border-border bg-panel p-4">
                        <div className="h-[620px]">
                            <Block preview={false} nodeModel={nodeModel} />
                        </div>
                    </div>
                </div>
            </TabModelContext.Provider>
        </WaveEnvContext.Provider>
    );
}

export default function SysinfoPreview() {
    return <SysinfoPreviewInner />;
}
