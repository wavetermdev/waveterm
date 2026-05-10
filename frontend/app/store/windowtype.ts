// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// waveWindowType is set once at startup and never changes.
let waveWindowType: "tab" | "preview" = "tab";

function getWaveWindowType(): "tab" | "preview" {
    return waveWindowType;
}

function isTabWindow(): boolean {
    return waveWindowType === "tab";
}

function isPreviewWindow(): boolean {
    return waveWindowType === "preview";
}

function setWaveWindowType(windowType: "tab" | "preview") {
    waveWindowType = windowType;
}

export { getWaveWindowType, isPreviewWindow, isTabWindow, setWaveWindowType };
