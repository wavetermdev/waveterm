// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Window-scoped download-progress bus. Electron delivers download progress at
// the webContents granularity (one webContents per Wave tab), so there is
// exactly one preload listener per window/tab, registered once and never torn
// down — the renderer context (and its ipcRenderer listeners) is reaped when
// the window/tab closes or reloads, matching how onFullScreenChange and
// onZoomFactorChange are wired in global-atoms.ts.
//
// Multiple concurrent downloads collapse to a single slot: the most recent
// downloadFile() call claims the slot and subsequent progress events overwrite
// it (last-write-wins). Per-file multiplexing would need a routing map keyed by
// filename/webContents and is not needed for the current single-banner UI.

import { getApi } from "@/store/global";
import type { DownloadProgress } from "./preview-model-upload";

let currentHandler: ((progress: DownloadProgress) => void) | null = null;
let registered = false;

function ensureRegistered() {
    if (registered) {
        return;
    }
    registered = true;
    try {
        getApi().onDownloadProgress((progress: DownloadProgress) => {
            currentHandler?.(progress);
        });
    } catch (e) {
        console.log("failed to initialize download progress listener", e);
    }
}

// Registers the window's download-progress listener exactly once and routes
// events to `handler` until the next claim. There is no per-claim teardown:
// the listener itself is window-scoped and lives for the page lifetime, while
// the single-slot handler is simply overwritten on each new download.
export function claimDownloadProgressSlot(handler: (progress: DownloadProgress) => void) {
    ensureRegistered();
    currentHandler = handler;
}
