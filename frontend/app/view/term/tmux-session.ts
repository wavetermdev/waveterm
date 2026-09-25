// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export async function applyTmuxSessionChange(
    currentSession: string,
    nextSession: string,
    persistSession: (session: string) => Promise<void>,
    restartController: () => Promise<void>
): Promise<boolean> {
    if (currentSession === nextSession) {
        return false;
    }
    await persistSession(nextSession);
    await restartController();
    return true;
}

export function toggleTmuxSession(currentSession: string, selectedSession: string): string {
    return currentSession === selectedSession ? "" : selectedSession;
}
