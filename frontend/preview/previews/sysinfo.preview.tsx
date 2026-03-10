// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import { handleWaveEvent } from "@/app/store/wps";
import { makeORef } from "@/app/store/wos";
import { WaveEnv, WaveEnvContext, useWaveEnv } from "@/app/waveenv/waveenv";
import { NodeModel } from "@/layout/index";
import { applyMockEnvOverrides } from "@/preview/mock/mockwaveenv";
import { atom, PrimitiveAtom, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

const PreviewBlockId = "preview-sysinfo-block";
const PreviewNodeId = "preview-sysinfo-node";
const PreviewConnection = "local";
const InitialPointCount = 120;

function makePreviewNodeModel(blockId: string): NodeModel {
    return {
        additionalProps: atom({ treeKey: "preview-sysinfo" }),
        innerRect: atom({ width: "100%", height: "100%" }),
        blockNum: atom(1),
        numLeafs: atom(2),
        nodeId: PreviewNodeId,
        blockId,
        addEphemeralNodeToLayout: () => {},
        animationTimeS: atom(0),
        isResizing: atom(false),
        isFocused: atom(true),
        isMagnified: atom(false),
        anyMagnified: atom(false),
        isEphemeral: atom(false),
        ready: atom(true),
        disablePointerEvents: atom(false),
        toggleMagnify: () => {},
        focusNode: () => {},
        onClose: () => {},
        dragHandleRef: { current: null },
        displayContainerRef: { current: null },
    };
}

function makeSysinfoSample(pointNum: number, ts: number): TimeSeriesData {
    const cpu = 50 + 18 * Math.sin(pointNum / 8) + 10 * Math.sin(pointNum / 3.5);
    const memTotal = 32;
    const memUsed = 20 + 4 * Math.sin(pointNum / 15) + 2 * Math.cos(pointNum / 6);
    return {
        ts,
        values: {
            cpu: Math.max(6, Math.min(96, cpu)),
            "cpu:0": Math.max(0, Math.min(100, cpu + 8 * Math.sin(pointNum / 4))),
            "cpu:1": Math.max(0, Math.min(100, cpu - 10 * Math.cos(pointNum / 5))),
            "cpu:2": Math.max(0, Math.min(100, cpu + 12 * Math.sin(pointNum / 6))),
            "cpu:3": Math.max(0, Math.min(100, cpu - 7 * Math.cos(pointNum / 7))),
            "mem:total": memTotal,
            "mem:used": Math.max(8, Math.min(memTotal - 1, memUsed)),
            "mem:free": Math.max(1, memTotal - memUsed),
            "mem:available": Math.max(2, memTotal - memUsed + 1.5),
        },
    };
}

function makeSysinfoEvent(pointNum: number, ts: number): Extract<WaveEvent, { event: "sysinfo" }> {
    return {
        event: "sysinfo",
        scopes: [PreviewConnection],
        data: makeSysinfoSample(pointNum, ts),
    };
}

function makeSysinfoHistory(nowTs: number, count: number): Extract<WaveEvent, { event: "sysinfo" }>[] {
    return Array.from({ length: count }, (_unused, index) => {
        const pointNum = index - count + 1;
        return makeSysinfoEvent(pointNum, nowTs - (count - index - 1) * 1000);
    });
}

function makePreviewBlock(blockId: string): Block {
    return {
        otype: "block",
        oid: blockId,
        version: 1,
        meta: {
            view: "sysinfo",
            connection: PreviewConnection,
            count: 0,
            "graph:numpoints": InitialPointCount,
            "sysinfo:type": "CPU + Mem",
        },
    };
}

function makePreviewTab(tabId: string, blockId: string): Tab {
    return {
        otype: "tab",
        oid: tabId,
        version: 1,
        name: "Sysinfo Preview",
        layoutstate: "",
        blockids: [blockId],
        meta: {},
    };
}

function SysinfoPreviewInner() {
    const baseEnv = useWaveEnv();
    const tabId = useAtomValue(baseEnv.atoms.staticTabId);
    const envRef = useRef<WaveEnv>(null);
    const nodeModelRef = useRef<NodeModel>(null);
    const historyRef = useRef<Extract<WaveEvent, { event: "sysinfo" }>[]>([]);
    const pointNumRef = useRef(0);
    const blockORef = makeORef("block", PreviewBlockId);

    if (historyRef.current.length === 0) {
        historyRef.current = makeSysinfoHistory(Date.now(), InitialPointCount);
        pointNumRef.current = historyRef.current.length;
    }

    if (nodeModelRef.current == null) {
        nodeModelRef.current = makePreviewNodeModel(PreviewBlockId);
    }

    if (envRef.current == null) {
        let previewEnv: WaveEnv;
        previewEnv = applyMockEnvOverrides(baseEnv, {
            tabId,
            mockWaveObjs: {
                [blockORef]: makePreviewBlock(PreviewBlockId),
                [makeORef("tab", tabId)]: makePreviewTab(tabId, PreviewBlockId),
            },
            rpc: {
                EventReadHistoryCommand: async (_client, data) => {
                    if (data?.event !== "sysinfo") {
                        return [];
                    }
                    const maxItems = data?.maxitems ?? historyRef.current.length;
                    return historyRef.current.slice(-maxItems);
                },
                SetMetaCommand: async (_client, data) => {
                    const blockAtom = previewEnv.wos.getWaveObjectAtom<Block>(data.oref) as PrimitiveAtom<Block>;
                    const block = globalStore.get(blockAtom);
                    if (block == null) {
                        return;
                    }
                    globalStore.set(blockAtom, {
                        ...block,
                        version: (block.version ?? 0) + 1,
                        meta: {
                            ...block.meta,
                            ...data.meta,
                        },
                    });
                },
            },
        });
        envRef.current = previewEnv;
    }

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            const event = makeSysinfoEvent(pointNumRef.current, Date.now());
            pointNumRef.current++;
            historyRef.current = [...historyRef.current.slice(-(InitialPointCount * 2 - 1)), event];
            handleWaveEvent(event);
        }, 1000);
        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <WaveEnvContext.Provider value={envRef.current}>
            <div className="w-full max-w-[1100px] p-6">
                <div className="mb-3 text-xs text-muted font-mono">full sysinfo block with live frontend-only WPS updates</div>
                <div className="h-[520px] rounded border border-border bg-panel p-2">
                    <Block key={PreviewBlockId} nodeModel={nodeModelRef.current} preview={false} />
                </div>
            </div>
        </WaveEnvContext.Provider>
    );
}

export function SysinfoPreview() {
    return <SysinfoPreviewInner />;
}
