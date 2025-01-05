// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";

function getWindow(): Window {
    return globalThis.window;
}

function getProcess(): NodeJS.Process {
    return globalThis.process;
}

/**
 * Gets an environment variable from the host process, either directly or via IPC if called from the browser.
 * @param paramName The name of the environment variable to attempt to retrieve.
 * @returns The value of the environment variable or null if not present.
 */
export function getEnv(paramName: string): string {
    const win = getWindow();
    if (win != null) {
        return getApi().getEnv(paramName);
    }
    const proc = getProcess();
    if (proc != null) {
        return proc.env[paramName];
    }
    return null;
}
