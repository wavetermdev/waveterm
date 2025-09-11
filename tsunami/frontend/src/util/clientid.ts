// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const CLIENT_ID_KEY = "tsunami:clientid";

/**
 * Gets or creates a unique client ID for this browser tab/window.
 * The client ID is stored in sessionStorage and persists for the lifetime of the tab.
 * If no client ID exists, a new UUID is generated and stored.
 */
export function getOrCreateClientId(): string {
    let clientId = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
        clientId = crypto.randomUUID();
        sessionStorage.setItem(CLIENT_ID_KEY, clientId);
    }
    return clientId;
}

/**
 * Clears the stored client ID from sessionStorage.
 * A new client ID will be generated on the next call to getOrCreateClientId().
 */
export function clearClientId(): void {
    sessionStorage.removeItem(CLIENT_ID_KEY);
}