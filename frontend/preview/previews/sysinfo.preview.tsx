// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { handleWaveEvent, setWpsRpcClient } from "@/app/store/wps";
import { makeORef } from "@/app/store/wos";
import { SysinfoViewModel } from "@/app/view/sysinfo/sysinfo";
import { useWaveEnv, WaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { atom } from "jotai";
import { useEffect, useRef } from "react";
import { applyMockEnvOverrides } from "../mock/mockwaveenv";

const DefaultHistoryPoints = 120;
const PreviewConnection = "local";
const fullConfigAtom = atom<FullConfigType>({ settings: {} } as unknown as FullConfigType);
const NoopWpsRpcClient = {
    wshRpcCall: () => Promise.resolve(null),
} as any;

type SysinfoPreviewEvent = Extract<WaveEvent, { event: "sysinfo" }>;
type SysinfoHistoryState = {
    tick: number;
    history: SysinfoPreviewEvent[];
};

type SysinfoScenarioType = {
    label: string;
    plotType: string;
    width: number;
    height: number;
    numPoints?: number;
};

const historyStateByConnection = new Map<string, SysinfoHistoryState>();
setWpsRpcClient(NoopWpsRpcClient);

const SysinfoScenarios: SysinfoScenarioType[] = [
    { label: "CPU", plotType: "CPU", width: 420, height: 260 },
    { label: "CPU + Mem", plotType: "CPU + Mem", width: 420, height: 260 },
    { label: "All CPU", plotType: "All CPU", width: 680, height: 420, numPoints: 90 },
];

function roundTo(value: number, decimalPlaces: number): number {
    return Number(value.toFixed(decimalPlaces));
}

function makeSysinfoData(ts: number, tick: number): TimeSeriesData {
    const values: Record<string, number> = {};
    const cpuValues: number[] = [];
    for (let idx = 0; idx < 8; idx++) {
        const cpuValue = 45 + 35 * Math.sin(tick / 6 + idx * 0.8) + 10 * Math.cos(tick / 11 + idx * 0.4);
        const clampedCpuValue = Math.max(3, Math.min(97, cpuValue));
        values[`cpu:${idx}`] = roundTo(clampedCpuValue, 0);
        cpuValues.push(clampedCpuValue);
    }
    const avgCpu = cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length;
    const memTotal = 32;
    const memUsed = Math.max(4, Math.min(memTotal - 1, 12 + 6 * Math.sin(tick / 12) + avgCpu / 15));
    values.cpu = roundTo(avgCpu, 0);
    values["mem:total"] = memTotal;
    values["mem:used"] = roundTo(memUsed, 1);
    values["mem:free"] = roundTo(memTotal - memUsed, 1);
    values["mem:available"] = roundTo(memTotal - memUsed * 0.8, 1);
    return { ts, values };
}

function makeSysinfoEvent(connection: string, ts: number, tick: number): SysinfoPreviewEvent {
    return {
        event: "sysinfo",
        scopes: [connection],
        data: makeSysinfoData(ts, tick),
    };
}

function getHistoryState(connection: string): SysinfoHistoryState {
    const existingState = historyStateByConnection.get(connection);
    if (existingState != null) {
        return existingState;
    }
    const state: SysinfoHistoryState = { tick: 0, history: [] };
    const endTs = Date.now() - 1000;
    for (let idx = DefaultHistoryPoints; idx >= 1; idx--) {
        state.tick++;
        state.history.push(makeSysinfoEvent(connection, endTs - (idx - 1) * 1000, state.tick));
    }
    historyStateByConnection.set(connection, state);
    return state;
}

function readHistory(connection: string, maxItems: number): SysinfoPreviewEvent[] {
    const state = getHistoryState(connection);
    return state.history.slice(-Math.max(1, maxItems));
}

function publishNextSysinfoEvent(connection: string) {
    const state = getHistoryState(connection);
    state.tick++;
    const nextEvent = makeSysinfoEvent(connection, Date.now(), state.tick);
    state.history.push(nextEvent);
    const maxHistory = DefaultHistoryPoints * 3;
    if (state.history.length > maxHistory) {
        state.history.splice(0, state.history.length - maxHistory);
    }
    handleWaveEvent(nextEvent);
}

function makeSysinfoPreviewBlock(blockId: string, plotType: string, numPoints: number): Block {
    return {
        otype: "block",
        oid: blockId,
        version: 1,
        meta: {
            view: "sysinfo",
            connection: PreviewConnection,
            "sysinfo:type": plotType,
            "graph:numpoints": numPoints,
        },
    };
}

function makeSysinfoEnv(baseEnv: WaveEnv, blockId: string, plotType: string, numPoints: number) {
    const blockORef = makeORef("block", blockId);
    let env: WaveEnv;
    env = applyMockEnvOverrides(baseEnv, {
        atoms: {
            fullConfigAtom,
        },
        mockWaveObjs: {
            [blockORef]: makeSysinfoPreviewBlock(blockId, plotType, numPoints),
        },
        rpc: {
            EventReadHistoryCommand: (_client, data) => {
                if (data?.event != "sysinfo" || data?.scope != PreviewConnection) {
                    return Promise.resolve([]);
                }
                return Promise.resolve(readHistory(PreviewConnection, data?.maxitems ?? DefaultHistoryPoints));
            },
            SetMetaCommand: (_client, data) => {
                if (data?.oref != blockORef || data?.meta == null) {
                    return Promise.resolve();
                }
                const blockAtom = env.getWaveObjectAtom<Block>(blockORef);
                const block = globalStore.get(blockAtom);
                globalStore.set(blockAtom, {
                    ...block,
                    version: (block?.version ?? 0) + 1,
                    meta: {
                        ...block?.meta,
                        ...data.meta,
                    },
                });
                return Promise.resolve();
            },
        },
    });
    return env;
}

function SysinfoScenario({ label, plotType, width, height, numPoints = DefaultHistoryPoints }: SysinfoScenarioType) {
    const baseEnv = useWaveEnv();
    const blockIdRef = useRef(`preview-sysinfo-${crypto.randomUUID()}`);
    const envRef = useRef<WaveEnv>(null);
    const modelRef = useRef<SysinfoViewModel>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    if (envRef.current == null) {
        envRef.current = makeSysinfoEnv(baseEnv, blockIdRef.current, plotType, numPoints);
    }
    if (modelRef.current == null) {
        modelRef.current = new SysinfoViewModel({
            blockId: blockIdRef.current,
            nodeModel: null as BlockNodeModel,
            tabModel: null as TabModel,
            waveEnv: envRef.current,
        });
    }

    const SysinfoViewComponent = modelRef.current.viewComponent;

    return (
        <div className="flex flex-col gap-2">
            <div className="text-xs text-muted font-mono">{label}</div>
            <WaveEnvContext.Provider value={envRef.current}>
                <div
                    ref={blockRef}
                    className="bg-panel border border-border rounded overflow-hidden"
                    style={{ width, height }}
                >
                    <div ref={contentRef} className="w-full h-full flex flex-col p-3">
                        <SysinfoViewComponent
                            blockId={blockIdRef.current}
                            blockRef={blockRef}
                            contentRef={contentRef}
                            model={modelRef.current}
                        />
                    </div>
                </div>
            </WaveEnvContext.Provider>
        </div>
    );
}

export function SysinfoPreview() {
    useEffect(() => {
        const intervalId = window.setInterval(() => publishNextSysinfoEvent(PreviewConnection), 1000);
        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <div className="flex flex-col gap-6 p-6">
            <div className="text-xs text-muted font-mono">
                Live sysinfo data is streamed in preview mode with handleWaveEvent(), without calling the backend.
            </div>
            <div className="flex flex-row gap-6 items-start flex-wrap">
                {SysinfoScenarios.map((scenario) => (
                    <SysinfoScenario key={scenario.label} {...scenario} />
                ))}
            </div>
        </div>
    );
}
