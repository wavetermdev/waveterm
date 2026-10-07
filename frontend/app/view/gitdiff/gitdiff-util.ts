// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// a changed signature means the file's diff must be refetched; content edits that keep identical +/- counts
// are only picked up on reselect or manual refresh
export function getFileSignature(file: GitFileStatus): string {
    return `${file.status}:${file.origpath ?? ""}:${file.additions ?? 0}:${file.deletions ?? 0}`;
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
