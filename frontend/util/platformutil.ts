// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const PlatformMacOS = "darwin";
export const PlatformWindows = "win32";
export const PlatformLinux = "linux";
export let PLATFORM: NodeJS.Platform = PlatformMacOS;
export let MacOSVersion: string = null;

export function setPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

export function setMacOSVersion(version: string) {
    MacOSVersion = version;
}

export function isMacOSTahoeOrLater(): boolean {
    if (!isMacOS() || MacOSVersion == null) {
        return false;
    }
    const major = parseInt(MacOSVersion.split(".")[0], 10);
    return major >= 16;
}

export function isMacOS(): boolean {
    return PLATFORM == PlatformMacOS;
}

export function isWindows(): boolean {
    return PLATFORM == PlatformWindows;
}

export function makeNativeLabel(isDirectory: boolean) {
    let managerName: string;
    if (!isDirectory) {
        managerName = "Default Application";
    } else if (PLATFORM === PlatformMacOS) {
        managerName = "Finder";
    } else if (PLATFORM == PlatformWindows) {
        managerName = "Explorer";
    } else {
        managerName = "File Manager";
    }

    let fileAction: string;
    if (isDirectory) {
        fileAction = "Reveal";
    } else {
        fileAction = "Open File";
    }
    return `${fileAction} in ${managerName}`;
}
