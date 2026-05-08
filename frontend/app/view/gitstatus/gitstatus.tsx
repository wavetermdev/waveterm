// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";

type GitStatusEnv = WaveEnvSubset<{
    rpc: {
        RemoteGitStatusCommand: WaveEnv["rpc"]["RemoteGitStatusCommand"];
    };
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"connection" | "cmd:cwd">;
    createBlock: WaveEnv["createBlock"];
}>;

const StatusLabels: Record<string, { label: string; color: string }> = {
    M: { label: "M", color: "text-yellow-400" },
    A: { label: "A", color: "text-green-400" },
    D: { label: "D", color: "text-red-400" },
    R: { label: "R", color: "text-blue-400" },
    C: { label: "C", color: "text-blue-400" },
    U: { label: "U", color: "text-orange-400" },
    "??": { label: "?", color: "text-gray-400" },
};

function getStatusInfo(status: string): { label: string; color: string } {
    return StatusLabels[status] ?? { label: status, color: "text-secondary" };
}

export class GitStatusViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    env: GitStatusEnv;

    viewIcon = jotai.atom<string>("code-branch");
    viewName = jotai.atom<string>("Git Status");
    manageConnection = jotai.atom<boolean>(true);
    noPadding = jotai.atom<boolean>(true);

    filesAtom: jotai.PrimitiveAtom<GitStatusFile[]>;
    branchAtom: jotai.PrimitiveAtom<string>;
    errorAtom: jotai.PrimitiveAtom<string>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;

    connection: jotai.Atom<string>;
    cwd: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;

    disposed = false;
    cancelPoll: (() => void) | null = null;
    fetchEpoch = 0;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "gitstatus";
        this.blockId = blockId;
        this.env = waveEnv;

        this.filesAtom = jotai.atom<GitStatusFile[]>([]) as jotai.PrimitiveAtom<GitStatusFile[]>;
        this.branchAtom = jotai.atom<string>("") as jotai.PrimitiveAtom<string>;
        this.errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
        this.loadingAtom = jotai.atom<boolean>(true) as jotai.PrimitiveAtom<boolean>;

        this.connection = jotai.atom((get) => {
            const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            if (isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.cwd = jotai.atom((get) => {
            return get(this.env.getBlockMetaKeyAtom(blockId, "cmd:cwd")) ?? "";
        });
        this.connStatus = jotai.atom((get) => {
            const connName = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.startPolling();
    }

    get viewComponent(): ViewComponent {
        return GitStatusView;
    }

    async doOneFetch() {
        if (this.disposed) return;
        const epoch = ++this.fetchEpoch;
        const conn = globalStore.get(this.connection);
        const cwd = globalStore.get(this.cwd);
        const connStatus = globalStore.get(this.connStatus);

        if (!connStatus?.connected || isBlank(cwd)) {
            return;
        }

        const route = makeConnRoute(conn);
        try {
            const resp = await this.env.rpc.RemoteGitStatusCommand(
                TabRpcClient,
                { cwd },
                { route }
            );
            if (this.disposed || this.fetchEpoch !== epoch) return;

            if (resp.error) {
                globalStore.set(this.errorAtom, resp.error);
                globalStore.set(this.filesAtom, []);
                globalStore.set(this.branchAtom, "");
            } else {
                globalStore.set(this.errorAtom, null);
                globalStore.set(this.filesAtom, resp.files ?? []);
                globalStore.set(this.branchAtom, resp.branch ?? "");
            }
            globalStore.set(this.loadingAtom, false);
        } catch (e) {
            if (this.disposed || this.fetchEpoch !== epoch) return;
            globalStore.set(this.errorAtom, String(e));
            globalStore.set(this.loadingAtom, false);
        }
    }

    startPolling() {
        let cancelled = false;
        this.cancelPoll = () => {
            cancelled = true;
        };

        const poll = async () => {
            while (!cancelled && !this.disposed) {
                await this.doOneFetch();
                if (cancelled || this.disposed) break;

                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 3000);
                    this.cancelPoll = () => {
                        clearTimeout(timer);
                        cancelled = true;
                        resolve();
                    };
                });

                if (!cancelled) {
                    this.cancelPoll = () => {
                        cancelled = true;
                    };
                }
            }
        };

        poll();
    }

    dispose() {
        this.disposed = true;
        this.cancelPoll?.();
    }

    openFile(filePath: string) {
        const cwd = globalStore.get(this.cwd);
        const conn = globalStore.get(this.connection);
        const fullPath = cwd + "/" + filePath;
        const meta: Record<string, any> = {
            view: "preview",
            file: fullPath,
        };
        if (conn !== "local") {
            meta.connection = conn;
        }
        this.env.createBlock({ meta });
    }

    openDiff(filePath: string) {
        const cwd = globalStore.get(this.cwd);
        const conn = globalStore.get(this.connection);
        const meta: Record<string, any> = {
            view: "term",
            controller: "cmd",
            cmd: `git diff -- "${filePath}"`,
            "cmd:cwd": cwd,
            "cmd:runonstart": true,
            "cmd:clearonstart": true,
        };
        if (conn !== "local") {
            meta.connection = conn;
        }
        this.env.createBlock({ meta });
    }
}

const GitStatusFileRow = React.memo(
    ({ file, model }: { file: GitStatusFile; model: GitStatusViewModel }) => {
        const statusInfo = getStatusInfo(file.status);

        return (
            <div
                className="flex items-center gap-2 px-3 py-1 hover:bg-hoverbg cursor-pointer group"
                onClick={() => model.openFile(file.file)}
                onDoubleClick={() => model.openDiff(file.file)}
            >
                <span className={`font-mono text-xs w-4 text-center font-bold ${statusInfo.color}`}>
                    {statusInfo.label}
                </span>
                <span className="text-xs text-secondary group-hover:text-white truncate flex-1">
                    {file.file}
                </span>
                <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-xs text-secondary hover:text-white cursor-pointer px-1"
                    onClick={(e) => {
                        e.stopPropagation();
                        model.openDiff(file.file);
                    }}
                    title="View Diff"
                >
                    <i className="fa fa-solid fa-code-compare"></i>
                </button>
            </div>
        );
    }
);
GitStatusFileRow.displayName = "GitStatusFileRow";

export const GitStatusView: React.FC<ViewComponentProps<GitStatusViewModel>> = React.memo(
    function GitStatusView({ model }) {
        const files = jotai.useAtomValue(model.filesAtom);
        const branch = jotai.useAtomValue(model.branchAtom);
        const error = jotai.useAtomValue(model.errorAtom);
        const loading = jotai.useAtomValue(model.loadingAtom);
        const cwd = jotai.useAtomValue(model.cwd);

        if (loading) {
            return (
                <div className="flex items-center justify-center h-full text-secondary">
                    <i className="fa fa-solid fa-spinner fa-spin text-lg"></i>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-secondary px-4 text-center">
                    <i className="fa fa-solid fa-triangle-exclamation text-lg text-warning mb-2"></i>
                    <span className="text-xs">{error}</span>
                </div>
            );
        }

        if (isBlank(cwd)) {
            return (
                <div className="flex items-center justify-center h-full text-secondary text-xs">
                    No working directory set
                </div>
            );
        }

        return (
            <div className="flex flex-col h-full overflow-hidden">
                {branch && (
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs text-secondary shrink-0">
                        <i className="fa fa-solid fa-code-branch"></i>
                        <span className="font-medium text-white">{branch}</span>
                        <span className="ml-auto">{files.length} changed</span>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto">
                    {files.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-secondary text-xs">
                            Working tree clean
                        </div>
                    ) : (
                        files.map((file, idx) => (
                            <GitStatusFileRow key={idx} file={file} model={model} />
                        ))
                    )}
                </div>
                <div className="flex items-center px-3 py-1 border-t border-border text-xxs text-muted shrink-0">
                    <span className="truncate">{cwd}</span>
                </div>
            </div>
        );
    }
);
