// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const PlatformMacOS = "darwin";
export const PlatformWindows = "win32";
export let PLATFORM: NodeJS.Platform = PlatformMacOS;

export function setPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

export function isMacOS(): boolean {
    return PLATFORM == PlatformMacOS;
}

export function isWindows(): boolean {
    return PLATFORM == PlatformWindows;
}
