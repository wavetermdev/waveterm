// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { globalStore } from "./jotaiStore";
import { ObjectService } from "./services";
import * as WOS from "./wos";

export type StalePathReason =
    | "not_found" // ENOENT - path does not exist
    | "not_directory" // Path exists but is not a directory
    | "access_denied" // EACCES - no permission to access
    | "network_error" // Timeout or network failure (after retries)
    | "unknown_error"; // Other errors

export interface PathValidationResult {
    valid: boolean;
    path: string;
    reason?: StalePathReason;
    fileInfo?: FileInfo;
}

interface RetryConfig {
    maxAttempts: number;
    timeoutPerAttempt: number;
    delayBetweenRetries: number;
    totalWindow: number;
}

const defaultRetryConfig: RetryConfig = {
    maxAttempts: 3,
    timeoutPerAttempt: 10000, // 10 seconds per attempt
    delayBetweenRetries: 1000, // 1 second delay between retries
    totalWindow: 30000, // Maximum 30 seconds total
};

// Sleep utility
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Classify error into StalePathReason
function classifyError(error: any): StalePathReason {
    const errorStr = String(error?.message || error || "").toLowerCase();

    // ENOENT - file not found
    if (errorStr.includes("enoent") || errorStr.includes("not found") || errorStr.includes("no such file")) {
        return "not_found";
    }

    // EACCES - access denied
    if (errorStr.includes("eacces") || errorStr.includes("permission denied") || errorStr.includes("access denied")) {
        return "access_denied";
    }

    // Network/timeout errors
    if (
        errorStr.includes("etimedout") ||
        errorStr.includes("timeout") ||
        errorStr.includes("econnrefused") ||
        errorStr.includes("ehostunreach") ||
        errorStr.includes("enetunreach") ||
        errorStr.includes("network")
    ) {
        return "network_error";
    }

    return "unknown_error";
}

// Check if a path looks like a network path
function isNetworkPath(path: string): boolean {
    if (!path) return false;

    // UNC paths (Windows): \\server\share or //server/share
    if (path.startsWith("\\\\") || path.startsWith("//")) {
        return true;
    }

    // SMB/CIFS: smb:// or cifs://
    if (path.startsWith("smb://") || path.startsWith("cifs://")) {
        return true;
    }

    // NFS paths (common patterns)
    // - server:/path (NFS)
    // - /net/server/path (automounter)
    if (/^[^\/\\]+:\//.test(path) || path.startsWith("/net/")) {
        return true;
    }

    return false;
}

// Validate path with timeout
async function validatePathWithTimeout(
    basedir: string,
    timeout: number
): Promise<PathValidationResult> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("ETIMEDOUT")), timeout);
    });

    try {
        const validationPromise = RpcApi.FileInfoCommand(TabRpcClient, { info: { path: basedir } }, null);
        const fileInfo = await Promise.race([validationPromise, timeoutPromise]);

        // Check if path was not found
        if (fileInfo.notfound) {
            return { valid: false, path: basedir, reason: "not_found" };
        }

        // Check if path is not a directory
        if (!fileInfo.isdir) {
            return { valid: false, path: basedir, reason: "not_directory" };
        }

        // Valid directory
        return { valid: true, path: basedir, fileInfo };
    } catch (error) {
        const reason = classifyError(error);
        return { valid: false, path: basedir, reason };
    }
}

// Validate with network retry mechanism
async function validateWithNetworkRetry(
    basedir: string,
    config: RetryConfig = defaultRetryConfig
): Promise<PathValidationResult> {
    let lastError: StalePathReason | null = null;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        try {
            const result = await validatePathWithTimeout(basedir, config.timeoutPerAttempt);

            if (result.valid) {
                return result; // Success on any attempt
            }

            // Non-network errors fail immediately (no retry)
            if (result.reason !== "network_error") {
                return result;
            }

            lastError = result.reason;

            // Don't delay after final attempt
            if (attempt < config.maxAttempts) {
                await sleep(config.delayBetweenRetries);
            }
        } catch (error) {
            lastError = classifyError(error);

            // Only retry network errors
            if (lastError !== "network_error" || attempt === config.maxAttempts) {
                return { valid: false, path: basedir, reason: lastError };
            }

            await sleep(config.delayBetweenRetries);
        }
    }

    // All retries exhausted
    return { valid: false, path: basedir, reason: "network_error" };
}

// Main validation function
export async function validateTabBasedir(
    tabId: string,
    basedir: string
): Promise<PathValidationResult> {
    if (!basedir || basedir.trim() === "") {
        return { valid: true, path: basedir }; // Empty path is considered valid (no validation needed)
    }

    // Detect if this is a network path
    const isNetwork = isNetworkPath(basedir);

    if (isNetwork) {
        // Use retry logic for network paths
        return await validateWithNetworkRetry(basedir);
    } else {
        // Single attempt for local paths
        return await validatePathWithTimeout(basedir, 5000); // 5 second timeout for local
    }
}

// Get user-friendly message for a stale path reason
function getReasonMessage(reason: StalePathReason, path: string): string {
    switch (reason) {
        case "not_found":
            return `Path no longer valid (not found): ${path}`;
        case "not_directory":
            return `Path is no longer a directory: ${path}`;
        case "access_denied":
            return `Cannot access directory (permission denied): ${path}`;
        case "network_error":
            return `Cannot reach network path (after retries): ${path}`;
        case "unknown_error":
            return `Path no longer accessible: ${path}`;
        default:
            return `Path validation failed: ${path}`;
    }
}

// Clear stale path and notify user
export async function handleStaleBasedir(
    tabId: string,
    path: string,
    reason: StalePathReason
): Promise<void> {
    const tabORef = WOS.makeORef("tab", tabId);

    try {
        // Clear both basedir and basedirlock
        await ObjectService.UpdateObjectMeta(tabORef, {
            "tab:basedir": null,
            "tab:basedirlock": false,
        });

        // Push notification
        const { pushNotification } = await import("./global");
        pushNotification({
            id: `stale-basedir-${tabId}`,
            icon: "triangle-exclamation",
            type: "warning",
            title: "Tab base directory cleared",
            message: getReasonMessage(reason, path),
            timestamp: new Date().toISOString(),
            expiration: Date.now() + 10000, // 10 second auto-dismiss
            persistent: false,
        });

        console.log(`[TabBasedir] Cleared stale basedir for tab ${tabId}: ${path} (${reason})`);
    } catch (error) {
        console.error(`[TabBasedir] Failed to clear stale basedir for tab ${tabId}:`, error);
    }
}

// Batch notification for multiple stale paths
export async function handleMultipleStaleBasedirs(
    staleTabs: Array<{ tabId: string; path: string; reason: StalePathReason }>
): Promise<void> {
    if (staleTabs.length === 0) return;

    // Clear all stale paths
    const clearPromises = staleTabs.map(({ tabId }) => {
        const tabORef = WOS.makeORef("tab", tabId);
        return ObjectService.UpdateObjectMeta(tabORef, {
            "tab:basedir": null,
            "tab:basedirlock": false,
        });
    });

    try {
        await Promise.all(clearPromises);

        // Push batched notification
        const { pushNotification } = await import("./global");
        pushNotification({
            id: "stale-basedir-batch",
            icon: "triangle-exclamation",
            type: "warning",
            title: `Cleared base directory for ${staleTabs.length} tabs`,
            message: "Multiple tabs had stale paths. See logs for details.",
            timestamp: new Date().toISOString(),
            expiration: Date.now() + 15000, // 15 second auto-dismiss
            persistent: false,
        });

        // Log individual paths for debugging
        staleTabs.forEach(({ tabId, path, reason }) => {
            console.log(`[TabBasedir] Cleared stale basedir for tab ${tabId}: ${path} (${reason})`);
        });
    } catch (error) {
        console.error("[TabBasedir] Failed to clear multiple stale basedirs:", error);
    }
}

// Batching state for tab validations
interface BatchingState {
    staleTabs: Array<{ tabId: string; path: string; reason: StalePathReason }>;
    timer: NodeJS.Timeout | null;
}

const batchingState: BatchingState = {
    staleTabs: [],
    timer: null,
};

const BATCHING_WINDOW_MS = 5000; // 5 second window for batching
const BATCH_THRESHOLD = 4; // Batch if 4+ tabs have stale paths

// Validate and handle stale basedir with batching support
export async function validateAndHandleStale(tabId: string): Promise<void> {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tabData = globalStore.get(tabAtom);

    if (!tabData) {
        return;
    }

    const basedir = tabData.meta?.["tab:basedir"];

    // Skip validation if no basedir set
    if (!basedir || basedir.trim() === "") {
        return;
    }

    // Perform validation
    const result = await validateTabBasedir(tabId, basedir);

    if (!result.valid && result.reason) {
        // Add to batching queue
        batchingState.staleTabs.push({ tabId, path: basedir, reason: result.reason });

        // Clear existing timer if any
        if (batchingState.timer) {
            clearTimeout(batchingState.timer);
        }

        // Set timer to process batch
        batchingState.timer = setTimeout(() => {
            const staleTabs = [...batchingState.staleTabs];
            batchingState.staleTabs = [];
            batchingState.timer = null;

            // Process batch
            if (staleTabs.length >= BATCH_THRESHOLD) {
                fireAndForget(() => handleMultipleStaleBasedirs(staleTabs));
            } else {
                // Process individually
                staleTabs.forEach(({ tabId, path, reason }) => {
                    fireAndForget(() => handleStaleBasedir(tabId, path, reason));
                });
            }
        }, BATCHING_WINDOW_MS);
    }
}
