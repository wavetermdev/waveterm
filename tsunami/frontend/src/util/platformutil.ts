// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const PlatformMacOS = "darwin";
export let PLATFORM: NodeJS.Platform = PlatformMacOS;

export function setPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

export function makeNativeLabel(isDirectory: boolean) {
    let managerName: string;
    if (!isDirectory) {
        managerName = "Default Application";
    } else if (PLATFORM === PlatformMacOS) {
        managerName = "Finder";
    } else if (PLATFORM == "win32") {
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
