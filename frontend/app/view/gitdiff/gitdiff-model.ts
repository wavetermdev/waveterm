// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { MetaKeyAtomFnType, SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { base64ToString, isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";
import { GitDiffView } from "./gitdiff";
import { isSameFileDiff } from "./gitdiff-util";

export type GitDiffEnv = WaveEnvSubset<{
    rpc: {
        RemoteGitStatusCommand: WaveEnv["rpc"]["RemoteGitStatusCommand"];
        RemoteGitFileDiffCommand: WaveEnv["rpc"]["RemoteGitFileDiffCommand"];
        RemoteGitRevertFileCommand: WaveEnv["rpc"]["RemoteGitRevertFileCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"connection" | "file" | "editor:inlinediff">;
    getSettingsKeyAtom: SettingsKeyAtomFnType<"editor:inlinediff">;
}>;

export type GitFileDiffState = {
    path: string;
    loading: boolean;
    original?: string;
    modified?: string;
    binary?: boolean;
    toolarge?: boolean;
    error?: string;
};

const PollIntervalMs = 5000;

export class GitDiffViewModel implements ViewModel {
    viewType = "gitdiff";
    blockId: string;
    env: GitDiffEnv;

    viewIcon = jotai.atom<string>("code-compare");
    viewName = jotai.atom<string>("Git Diff");
    noPadding = jotai.atom<boolean>(true);

    statusAtom = jotai.atom<GitStatusRtnData>(null) as jotai.PrimitiveAtom<GitStatusRtnData>;
    loadingAtom = jotai.atom<boolean>(true) as jotai.PrimitiveAtom<boolean>;
    errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
    selectedPathAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
    fileDiffAtom = jotai.atom<GitFileDiffState>(null) as jotai.PrimitiveAtom<GitFileDiffState>;

    connection: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;
    cwdAtom: jotai.Atom<string>;
    inlineDiffAtom: jotai.Atom<boolean>;
    viewText: jotai.Atom<HeaderElem[]>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;

    disposed = false;
    refreshInFlight = false;
    refreshQueued = false;
    pollTimer: ReturnType<typeof setInterval> = null;
    diffEpoch = 0;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;

        this.connection = jotai.atom((get) => {
            const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            if (isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.connStatus = jotai.atom((get) => {
            const connName = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            return get(this.env.getConnStatusAtom(connName));
        });
        this.cwdAtom = jotai.atom((get) => get(this.env.getBlockMetaKeyAtom(blockId, "file")));
        this.inlineDiffAtom = jotai.atom((get) => {
            const metaVal = get(this.env.getBlockMetaKeyAtom(blockId, "editor:inlinediff"));
            if (metaVal != null) {
                return metaVal;
            }
            return !!get(this.env.getSettingsKeyAtom("editor:inlinediff"));
        });
        this.viewText = jotai.atom((get) => {
            const status = get(this.statusAtom);
            if (status == null || status.notrepo) {
                return [];
            }
            const repoName = status.reporoot?.split(/[\\/]/).filter(Boolean).pop() ?? "";
            const rtn: HeaderElem[] = [];
            rtn.push({ elemtype: "text", text: status.branch ? `${repoName} · ${status.branch}` : repoName });
            const files = status.files ?? [];
            const additions = files.reduce((acc, f) => acc + (f.additions ?? 0), 0);
            const deletions = files.reduce((acc, f) => acc + (f.deletions ?? 0), 0);
            const countText = `${files.length}${status.truncated ? "+" : ""} file${files.length === 1 ? "" : "s"}`;
            rtn.push({ elemtype: "text", text: countText, className: "text-secondary" });
            if (additions > 0) {
                rtn.push({ elemtype: "text", text: `+${additions}`, className: "text-success", noGrow: true });
            }
            if (deletions > 0) {
                rtn.push({ elemtype: "text", text: `−${deletions}`, className: "text-error", noGrow: true });
            }
            return rtn;
        });
        this.endIconButtons = jotai.atom((get) => {
            const inlineDiff = get(this.inlineDiffAtom);
            return [
                {
                    elemtype: "iconbutton",
                    icon: inlineDiff ? "table-columns" : "bars",
                    title: inlineDiff ? "Show Side-by-Side Diff" : "Show Inline Diff",
                    click: () => this.toggleInlineDiff(),
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh",
                    click: () => this.refresh(),
                },
            ];
        });
    }

    get viewComponent(): ViewComponent {
        return GitDiffView;
    }

    startPolling() {
        this.stopPolling();
        this.refresh();
        this.pollTimer = setInterval(() => {
            if (document.hidden) {
                return;
            }
            this.refresh();
        }, PollIntervalMs);
    }

    stopPolling() {
        if (this.pollTimer == null) {
            return;
        }
        clearInterval(this.pollTimer);
        this.pollTimer = null;
    }

    resetState() {
        globalStore.set(this.statusAtom, null);
        globalStore.set(this.errorAtom, null);
        globalStore.set(this.selectedPathAtom, null);
        globalStore.set(this.fileDiffAtom, null);
        globalStore.set(this.loadingAtom, true);
    }

    async refresh() {
        if (this.disposed) {
            return;
        }
        if (this.refreshInFlight) {
            // an explicit refresh (e.g. after a revert) must not be dropped while a poll is in flight
            this.refreshQueued = true;
            return;
        }
        const connStatus = globalStore.get(this.connStatus);
        if (!connStatus?.connected) {
            globalStore.set(this.loadingAtom, false);
            return;
        }
        const cwd = globalStore.get(this.cwdAtom);
        const route = makeConnRoute(globalStore.get(this.connection));
        this.refreshInFlight = true;
        try {
            const status = await this.env.rpc.RemoteGitStatusCommand(TabRpcClient, { cwd }, { route });
            if (!this.isCurrentTarget(cwd, route)) {
                return;
            }
            globalStore.set(this.statusAtom, status);
            globalStore.set(this.errorAtom, null);
            this.reconcileSelection(status);
        } catch (e) {
            if (this.isCurrentTarget(cwd, route)) {
                globalStore.set(this.errorAtom, String(e?.message ?? e));
            }
        } finally {
            this.refreshInFlight = false;
            if (this.isCurrentTarget(cwd, route)) {
                globalStore.set(this.loadingAtom, false);
            }
        }
        if (this.refreshQueued) {
            this.refreshQueued = false;
            await this.refresh();
        }
    }

    // cwd or connection can change while a status request is in flight; its result then belongs to another repo
    isCurrentTarget(cwd: string, route: string): boolean {
        if (this.disposed) {
            return false;
        }
        return globalStore.get(this.cwdAtom) === cwd && makeConnRoute(globalStore.get(this.connection)) === route;
    }

    reconcileSelection(status: GitStatusRtnData) {
        const files = status?.files ?? [];
        const selectedPath = globalStore.get(this.selectedPathAtom);
        let selected = files.find((f) => f.path === selectedPath);
        if (selected == null) {
            selected = files[0];
        }
        if (selected == null) {
            globalStore.set(this.selectedPathAtom, null);
            globalStore.set(this.fileDiffAtom, null);
            return;
        }
        globalStore.set(this.selectedPathAtom, selected.path);
        // always refetch: edits that keep the same status and +/- counts would otherwise leave a stale diff
        this.loadFileDiff(selected);
    }

    selectFile(file: GitFileStatus) {
        if (file == null) {
            return;
        }
        globalStore.set(this.selectedPathAtom, file.path);
        this.loadFileDiff(file);
    }

    async loadFileDiff(file: GitFileStatus) {
        const status = globalStore.get(this.statusAtom);
        if (status?.reporoot == null) {
            return;
        }
        const epoch = ++this.diffEpoch;
        const curDiff = globalStore.get(this.fileDiffAtom);
        if (curDiff?.path !== file.path) {
            globalStore.set(this.fileDiffAtom, { path: file.path, loading: true });
        }
        const route = makeConnRoute(globalStore.get(this.connection));
        try {
            const rtn = await this.env.rpc.RemoteGitFileDiffCommand(
                TabRpcClient,
                { reporoot: status.reporoot, path: file.path, origpath: file.origpath, status: file.status },
                { route }
            );
            if (this.disposed || epoch !== this.diffEpoch) {
                return;
            }
            const newDiff: GitFileDiffState = {
                path: file.path,
                loading: false,
                original: base64ToString(rtn?.originalcontents64 ?? ""),
                modified: base64ToString(rtn?.modifiedcontents64 ?? ""),
                binary: rtn?.binary,
                toolarge: rtn?.toolarge,
            };
            if (isSameFileDiff(globalStore.get(this.fileDiffAtom), newDiff)) {
                return;
            }
            globalStore.set(this.fileDiffAtom, newDiff);
        } catch (e) {
            if (this.disposed || epoch !== this.diffEpoch) {
                return;
            }
            globalStore.set(this.fileDiffAtom, {
                path: file.path,
                loading: false,
                error: String(e?.message ?? e),
            });
        }
    }

    async revertFile(file: GitFileStatus) {
        const status = globalStore.get(this.statusAtom);
        if (file == null || status?.reporoot == null) {
            return;
        }
        const message =
            file.status === "untracked"
                ? `Delete untracked file "${file.path}"?\n\nThis file is not tracked by git and cannot be recovered.`
                : `Discard all changes to "${file.path}"?\n\nThis restores the file to HEAD (staged and unstaged changes) and cannot be undone.`;
        if (!window.confirm(message)) {
            return;
        }
        const route = makeConnRoute(globalStore.get(this.connection));
        try {
            await this.env.rpc.RemoteGitRevertFileCommand(
                TabRpcClient,
                { reporoot: status.reporoot, path: file.path, origpath: file.origpath, status: file.status },
                { route }
            );
        } catch (e) {
            globalStore.set(this.errorAtom, `Revert failed: ${String(e?.message ?? e)}`);
            return;
        }
        if (globalStore.get(this.selectedPathAtom) === file.path) {
            globalStore.set(this.fileDiffAtom, null);
        }
        await this.refresh();
    }

    toggleInlineDiff() {
        const inlineDiff = globalStore.get(this.inlineDiffAtom);
        this.env.rpc.SetMetaCommand(TabRpcClient, {
            oref: makeORef("block", this.blockId),
            meta: { "editor:inlinediff": !inlineDiff },
        });
    }

    dispose() {
        this.disposed = true;
        this.stopPolling();
    }
}
