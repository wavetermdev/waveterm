// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// for activity updates
let wasActive = true;
let wasInFg = true;
let globalIsQuitting = false;
let globalIsStarting = true;
let globalIsRelaunching = false;
let forceQuit = false;

export function setWasActive(val: boolean) {
    wasActive = val;
}

export function setWasInFg(val: boolean) {
    wasInFg = val;
}

export function getActivityState(): { wasActive: boolean; wasInFg: boolean } {
    return { wasActive, wasInFg };
}

export function setGlobalIsQuitting(val: boolean) {
    globalIsQuitting = val;
}

export function getGlobalIsQuitting(): boolean {
    return globalIsQuitting;
}

export function setGlobalIsStarting(val: boolean) {
    globalIsStarting = val;
}

export function getGlobalIsStarting(): boolean {
    return globalIsStarting;
}

export function setGlobalIsRelaunching(val: boolean) {
    globalIsRelaunching = val;
}

export function getGlobalIsRelaunching(): boolean {
    return globalIsRelaunching;
}

export function setForceQuit(val: boolean) {
    forceQuit = val;
}

export function getForceQuit(): boolean {
    return forceQuit;
}
