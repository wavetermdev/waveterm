// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

const MaxHistory = 20;

// this needs to be fixed for windows
function getParentDirectory(path: string): string {
    if (util.isBlank(path) == null) {
        // this not great, ideally we'd never be passed a null path
        return "/";
    }
    if (path == "/") {
        return "/";
    }
    const splitPath = path.split("/");
    splitPath.pop();
    if (splitPath.length == 1 && splitPath[0] == "") {
        return "/";
    }
    const newPath = splitPath.join("/");
    return newPath;
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
