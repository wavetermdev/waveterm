// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// waveWindowType is set once at startup and never changes.
let waveWindowType: "tab" | "builder" | "preview" = "tab";

function getWaveWindowType(): "tab" | "builder" | "preview" {
    return waveWindowType;
}

function isBuilderWindow(): boolean {
    return waveWindowType === "builder";
}

function isTabWindow(): boolean {
    return waveWindowType === "tab";
}

function isPreviewWindow(): boolean {
    return waveWindowType === "preview";
}

function setWaveWindowType(windowType: "tab" | "builder" | "preview") {
    waveWindowType = windowType;
}

export { getWaveWindowType, isBuilderWindow, isPreviewWindow, isTabWindow, setWaveWindowType };
