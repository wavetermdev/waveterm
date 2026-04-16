// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

const MaxHistory = 20;

const windowsDriveRootRe = /^[a-zA-Z]:[\\/]?$/;
const windowsDrivePathRe = /^[a-zA-Z]:[\\/]/;

function isPathSeparator(ch: string): boolean {
    return ch == "/" || ch == "\\";
}

function getWindowsDriveRoot(path: string): string | null {
    if (!windowsDrivePathRe.test(path) && !windowsDriveRootRe.test(path)) {
        return null;
    }
    return path.substring(0, 2) + (path.includes("/") && !path.includes("\\") ? "/" : "\\");
}

function getUncRootEnd(path: string): number {
    if (path.length < 3 || !isPathSeparator(path[0]) || path[0] != path[1]) {
        return -1;
    }

    let serverEnd = -1;
    for (let index = 2; index < path.length; index++) {
        if (isPathSeparator(path[index])) {
            serverEnd = index;
            break;
        }
    }
    if (serverEnd == -1) {
        return path.length;
    }

    for (let index = serverEnd + 1; index < path.length; index++) {
        if (isPathSeparator(path[index])) {
            return index;
        }
    }
    return path.length;
}

function trimTrailingSeparators(path: string): string {
    const windowsDriveRoot = getWindowsDriveRoot(path);
    if (windowsDriveRoot != null && path.length <= windowsDriveRoot.length) {
        return windowsDriveRoot;
    }

    const uncRootEnd = getUncRootEnd(path);
    let minLength = 1;
    if (windowsDriveRoot != null) {
        minLength = windowsDriveRoot.length;
    } else if (uncRootEnd != -1) {
        minLength = uncRootEnd;
    }

    let end = path.length;
    while (end > minLength && isPathSeparator(path[end - 1])) {
        end--;
    }
    return path.substring(0, end);
}

function getParentDirectory(path: string): string {
    if (util.isBlank(path)) {
        // this not great, ideally we'd never be passed a null path
        return "/";
    }
    if (path == "/" || path == "~") {
        return path;
    }

    const windowsDriveRoot = getWindowsDriveRoot(path);
    if (windowsDriveRoot != null && path.length <= windowsDriveRoot.length) {
        return windowsDriveRoot;
    }

    const trimmedPath = trimTrailingSeparators(path);
    if (trimmedPath == "/" || trimmedPath == "~") {
        return trimmedPath;
    }

    const uncRootEnd = getUncRootEnd(trimmedPath);
    if (uncRootEnd != -1 && trimmedPath.length <= uncRootEnd) {
        return trimmedPath;
    }

    let lastSeparatorIndex = -1;
    for (let index = trimmedPath.length - 1; index >= 0; index--) {
        if (isPathSeparator(trimmedPath[index])) {
            lastSeparatorIndex = index;
            break;
        }
    }
    if (lastSeparatorIndex == -1) {
        return trimmedPath;
    }
    if (lastSeparatorIndex == 0) {
        return "/";
    }
    if (windowsDriveRoot != null && lastSeparatorIndex <= windowsDriveRoot.length - 1) {
        return windowsDriveRoot;
    }
    if (uncRootEnd != -1 && lastSeparatorIndex <= uncRootEnd) {
        return trimmedPath.substring(0, uncRootEnd);
    }
    return trimmedPath.substring(0, lastSeparatorIndex);
}

function goHistoryBack(curValKey: "url" | "file", curVal: string, meta: MetaType, backToParent: boolean): MetaType {
    const rtnMeta: MetaType = {};
    const history = (meta?.history ?? []).slice();
    const historyForward = (meta?.["history:forward"] ?? []).slice();
    if (history == null || history.length == 0) {
        if (backToParent) {
            const parentDir = getParentDirectory(curVal);
            if (parentDir == curVal) {
                return null;
            }
            historyForward.unshift(curVal);
            while (historyForward.length > MaxHistory) {
                historyForward.pop();
            }
            return { [curValKey]: parentDir, "history:forward": historyForward };
        } else {
            return null;
        }
    }
    const lastVal = history.pop();
    historyForward.unshift(curVal);
    return { [curValKey]: lastVal, history: history, "history:forward": historyForward };
}

function goHistoryForward(curValKey: "url" | "file", curVal: string, meta: MetaType): MetaType {
    const rtnMeta: MetaType = {};
    let history = (meta?.history ?? []).slice();
    const historyForward = (meta?.["history:forward"] ?? []).slice();
    if (historyForward == null || historyForward.length == 0) {
        return null;
    }
    const lastVal = historyForward.shift();
    history.push(curVal);
    if (history.length > MaxHistory) {
        history.shift();
    }
    return { [curValKey]: lastVal, history: history, "history:forward": historyForward };
}

function goHistory(curValKey: "url" | "file", curVal: string, newVal: string, meta: MetaType): MetaType {
    const rtnMeta: MetaType = {};
    const history = (meta?.history ?? []).slice();
    history.push(curVal);
    if (history.length > MaxHistory) {
        history.shift();
    }
    return { [curValKey]: newVal, history: history, "history:forward": [] };
}

export { getParentDirectory, goHistory, goHistoryBack, goHistoryForward };
