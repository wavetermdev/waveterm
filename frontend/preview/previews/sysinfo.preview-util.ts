// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultSysinfoHistoryPoints = 140;
export const MockSysinfoConnection = "local";

const MockMemoryTotal = 32;
const MockCoreCount = 6;

function clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

export function makeMockSysinfoEvent(
    ts: number,
    step: number,
    scope = MockSysinfoConnection
): Extract<WaveEvent, { event: "sysinfo" }> {
    const baseCpu = clamp(42 + 18 * Math.sin(step / 6) + 8 * Math.cos(step / 3.5), 8, 96);
    const memUsed = clamp(12 + 4 * Math.sin(step / 10) + 2 * Math.cos(step / 7), 6, MockMemoryTotal - 4);
    const memAvailable = clamp(MockMemoryTotal - memUsed + 1.5, 0, MockMemoryTotal);
    const values: Record<string, number> = {
        cpu: round1(baseCpu),
        "mem:total": MockMemoryTotal,
        "mem:used": round1(memUsed),
        "mem:free": round1(MockMemoryTotal - memUsed),
        "mem:available": round1(memAvailable),
    };

    for (let i = 0; i < MockCoreCount; i++) {
        const coreCpu = clamp(baseCpu + 10 * Math.sin(step / 4 + i) + i - 3, 2, 100);
        values[`cpu:${i}`] = round1(coreCpu);
    }

    return {
        event: "sysinfo",
        scopes: [scope],
        data: {
            ts,
            values,
        },
    };
}

export function makeMockSysinfoHistory(
    numPoints = DefaultSysinfoHistoryPoints,
    endTs = Date.now()
): Extract<WaveEvent, { event: "sysinfo" }>[] {
    const history: Extract<WaveEvent, { event: "sysinfo" }>[] = [];
    const startTs = endTs - (numPoints - 1) * 1000;

    for (let i = 0; i < numPoints; i++) {
        history.push(makeMockSysinfoEvent(startTs + i * 1000, i));
    }

    return history;
}
