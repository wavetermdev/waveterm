// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { GitFileDiffState } from "./gitdiff-model";

// the selected diff is refetched on every poll, so skip identical results to avoid needless re-renders
export function isSameFileDiff(a: GitFileDiffState, b: GitFileDiffState): boolean {
    if (a == null || b == null) {
        return a == b;
    }
    return (
        a.path === b.path &&
        a.loading === b.loading &&
        a.original === b.original &&
        a.modified === b.modified &&
        !!a.binary === !!b.binary &&
        !!a.toolarge === !!b.toolarge &&
        a.error === b.error
    );
}

export function isWshOutdatedError(errMsg: string): boolean {
    if (errMsg == null) {
        return false;
    }
    return /command "remotegit\w+" not found/.test(errMsg);
}

export function splitRepoPath(filePath: string): { dir: string; name: string } {
    const idx = filePath.lastIndexOf("/");
    if (idx === -1) {
        return { dir: "", name: filePath };
    }
    return { dir: filePath.substring(0, idx), name: filePath.substring(idx + 1) };
}
