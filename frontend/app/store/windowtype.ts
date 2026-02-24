// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// waveWindowType is set once at startup and never changes.
let waveWindowType: "tab" | "builder" = "tab";

function getWaveWindowType(): "tab" | "builder" {
    return waveWindowType;
}

function isBuilderWindow(): boolean {
    return waveWindowType === "builder";
}

function isTabWindow(): boolean {
    return waveWindowType === "tab";
}

function setWaveWindowType(windowType: "tab" | "builder") {
    waveWindowType = windowType;
}

export { getWaveWindowType, isBuilderWindow, isTabWindow, setWaveWindowType };
