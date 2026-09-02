// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import { getWebServerEndpoint } from "../frontend/util/endpoints";

// Temp directories created for native file drag-out are registered here so they
// can be swept on TTL expiry or application quit. This lifecycle will be extended
// in Phase 4 (drag progress), but the registry + cleanup is shared from the start.
const tempDragDirs = new Set<string>();
// Per-webContents registry: maps a webContents id to the temp dirs it created.
// Used by the "cleanup-drag-temp" IPC handler to remove all dirs for a
// webContents when a drag ends.
const tempDragDirsByWebContents = new Map<number, Set<string>>();

export const TEMP_DRAG_DIR_PREFIX = "wave-drag-";
export const TEMP_DRAG_FILE_TTL_MS = 10 * 60 * 1000;

/**
 * Builds the stream URL used to download a remote file for native drag-out.
 * The Go handler (handleStreamFile) only reads the `path` query param, so we do
 * not include a baseName path segment here.
 */
export function buildStreamFileUrl(remoteUri: string): string {
    return getWebServerEndpoint() + "/wave/stream-file?path=" + encodeURIComponent(remoteUri);
}

export function registerTempDragDir(webContentsId: number, dir: string): void {
    tempDragDirs.add(dir);
    let dirs = tempDragDirsByWebContents.get(webContentsId);
    if (dirs == null) {
        dirs = new Set<string>();
        tempDragDirsByWebContents.set(webContentsId, dirs);
    }
    dirs.add(dir);
}

export function getRegisteredTempDragDirs(): string[] {
    return Array.from(tempDragDirs);
}

/**
 * Removes every temp dir registered for a webContents and drops them from both
 * the flat registry and the per-webContents registry. Idempotent: a second call
 * for the same webContents id is a no-op.
 */
export async function cleanupTempDirsForWebContents(webContentsId: number): Promise<void> {
    const dirs = tempDragDirsByWebContents.get(webContentsId);
    if (dirs == null) {
        return;
    }
    tempDragDirsByWebContents.delete(webContentsId);
    const dirList = Array.from(dirs);
    for (const dir of dirList) {
        tempDragDirs.delete(dir);
    }
    await Promise.all(dirList.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
}

function removeDirFromWebContentsMap(dir: string): void {
    for (const [webContentsId, dirs] of tempDragDirsByWebContents) {
        dirs.delete(dir);
        if (dirs.size === 0) {
            tempDragDirsByWebContents.delete(webContentsId);
        }
    }
}

/**
 * Removes a single temp dir (if still registered) and drops it from the registry.
 * Idempotent: a second call for the same dir is a no-op.
 */
export async function cleanupTempDragDir(dir: string): Promise<void> {
    if (!tempDragDirs.has(dir)) {
        return;
    }
    tempDragDirs.delete(dir);
    removeDirFromWebContentsMap(dir);
    await fs.promises.rm(dir, { recursive: true, force: true });
}

/**
 * Removes all registered temp dirs (used on application quit).
 */
export async function cleanupAllTempDragFiles(): Promise<void> {
    const dirs = Array.from(tempDragDirs);
    tempDragDirs.clear();
    tempDragDirsByWebContents.clear();
    await Promise.all(dirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
}

/**
 * Schedules a temp dir for TTL-based cleanup so abandoned drags don't leak files.
 */
export function scheduleTempDragDirCleanup(dir: string, ttlMs: number = TEMP_DRAG_FILE_TTL_MS): void {
    setTimeout(() => {
        cleanupTempDragDir(dir).catch((err) => {
            console.error(`Failed to clean up temp drag dir ${dir}:`, err);
        });
    }, ttlMs);
}
