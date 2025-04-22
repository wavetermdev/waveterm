// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Execute a promise without waiting for it to resolve.
 * Useful for fire-and-forget operations where you don't need to wait for the result.
 *
 * @param promise A function that returns a promise
 */
export function fireAndForget(promise: () => Promise<any>): void {
    promise().catch((err) => {
        console.error("Unhandled error in fireAndForget:", err);
    });
}
