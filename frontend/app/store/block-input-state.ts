// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const LastUserInputMsByBlockId = new Map<string, number>();

function recordBlockUserInput(blockId: string): void {
    if (!blockId) {
        return;
    }
    LastUserInputMsByBlockId.set(blockId, Date.now());
}

function getBlockLastUserInputMs(blockId: string): number {
    if (!blockId) {
        return 0;
    }
    return LastUserInputMsByBlockId.get(blockId) ?? 0;
}

function clearBlockUserInput(blockId: string): void {
    if (!blockId) {
        return;
    }
    LastUserInputMsByBlockId.delete(blockId);
}

export { clearBlockUserInput, getBlockLastUserInputMs, recordBlockUserInput };
