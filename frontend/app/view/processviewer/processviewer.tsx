// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";

// ---- types ----

type ProcessViewerEnv = WaveEnvSubset<{
    rpc: {
        RemoteProcessListCommand: WaveEnv["rpc"]["RemoteProcessListCommand"];
    };
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"connection">;
}>;

type SortCol = "pid" | "command" | "user" | "cpu" | "mem" | "status" | "threads";

const RowHeight = 24;
const OverscanRows = 100;

// ---- format helpers ----

function fmtMem(bytes: number): string {
    if (bytes == null) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " K";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " M";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " G";
}

function fmtCpu(cpu: number): string {
    if (cpu == null) return "";
    return cpu.toFixed(1) + "%";
}

// ---- model ----

export class ProcessViewerViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    env: ProcessViewerEnv;

    viewIcon = jotai.atom<string>("microchip");
    viewName = jotai.atom<string>("Processes");
    manageConnection = jotai.atom<boolean>(true);
    filterOutNowsh = jotai.atom<boolean>(true);
    noPadding = jotai.atom<boolean>(true);

    dataAtom: jotai.PrimitiveAtom<ProcessListResponse>;
    sortByAtom: jotai.PrimitiveAtom<SortCol>;
    sortDescAtom: jotai.PrimitiveAtom<boolean>;
    scrollTopAtom: jotai.PrimitiveAtom<number>;
    containerHeightAtom: jotai.PrimitiveAtom<number>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;

    connection: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;

    disposed = false;
    cancelPoll: (() => void) | null = null;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "processviewer";
        this.blockId = blockId;
        this.env = waveEnv;

        this.dataAtom = jotai.atom<ProcessListResponse>(null) as jotai.PrimitiveAtom<ProcessListResponse>;
        this.sortByAtom = jotai.atom<SortCol>("cpu");
        this.sortDescAtom = jotai.atom<boolean>(true);
        this.scrollTopAtom = jotai.atom<number>(0);
        this.containerHeightAtom = jotai.atom<number>(0);
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;

        this.connection = jotai.atom((get) => {
            const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            if (isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.connStatus = jotai.atom((get) => {
            const connName = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.startPolling();
    }

    get viewComponent(): ViewComponent {
        return ProcessViewerView;
    }

    startPolling() {
        let cancelled = false;
        this.cancelPoll = () => {
            cancelled = true;
        };

        const poll = async () => {
            while (!cancelled && !this.disposed) {
                const sortBy = globalStore.get(this.sortByAtom);
                const sortDesc = globalStore.get(this.sortDescAtom);
                const scrollTop = globalStore.get(this.scrollTopAtom);
                const containerHeight = globalStore.get(this.containerHeightAtom);
                const conn = globalStore.get(this.connection);

                const start = Math.max(0, Math.floor(scrollTop / RowHeight) - OverscanRows);
                const visibleRows = containerHeight > 0 ? Math.ceil(containerHeight / RowHeight) : 50;
                const limit = visibleRows + OverscanRows * 2;

                const route = makeConnRoute(conn);

                try {
                    console.log("RemoteProcessList", sortBy, sortDesc, start, limit);
                    const resp = await this.env.rpc.RemoteProcessListCommand(
                        TabRpcClient,
                        {
                            sortby: sortBy,
                            sortdesc: sortDesc,
                            start,
                            limit,
                        },
                        { route }
                    );
                    if (!cancelled && !this.disposed) {
                        globalStore.set(this.dataAtom, resp);
                        globalStore.set(this.loadingAtom, false);
                        globalStore.set(this.errorAtom, null);
                    }
                    (window as any).RPL = resp; // debugging (remove before commit)
                } catch (e) {
                    if (!cancelled && !this.disposed) {
                        globalStore.set(this.loadingAtom, false);
                        globalStore.set(this.errorAtom, String(e));
                    }
                }

                if (cancelled || this.disposed) break;

                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 1000);
                    const origCancel = this.cancelPoll;
                    this.cancelPoll = () => {
                        clearTimeout(timer);
                        if (origCancel) origCancel();
                        resolve();
                    };
                });
            }
        };

        poll();
    }

    triggerRefresh() {
        if (this.cancelPoll) {
            this.cancelPoll();
        }
        this.cancelPoll = null;
        this.startPolling();
    }

    setSort(col: SortCol) {
        const curSort = globalStore.get(this.sortByAtom);
        const curDesc = globalStore.get(this.sortDescAtom);
        const numericCols: SortCol[] = ["cpu", "mem", "threads"];
        if (curSort === col) {
            globalStore.set(this.sortDescAtom, !curDesc);
        } else {
            globalStore.set(this.sortByAtom, col);
            globalStore.set(this.sortDescAtom, numericCols.includes(col));
        }
        this.triggerRefresh();
    }

    setScrollTop(scrollTop: number) {
        const cur = globalStore.get(this.scrollTopAtom);
        if (Math.abs(cur - scrollTop) < RowHeight) return;
        globalStore.set(this.scrollTopAtom, scrollTop);
        this.triggerRefresh();
    }

    setContainerHeight(height: number) {
        const cur = globalStore.get(this.containerHeightAtom);
        if (cur === height) return;
        globalStore.set(this.containerHeightAtom, height);
        this.triggerRefresh();
    }

    dispose() {
        this.disposed = true;
        if (this.cancelPoll) {
            this.cancelPoll();
            this.cancelPoll = null;
        }
    }
}

// ---- column definitions ----

type ColDef = {
    key: SortCol;
    label: string;
    tooltip?: string;
    width: string;
    align?: "right";
    hideOnWindows?: boolean;
};

const Columns: ColDef[] = [
    { key: "pid", label: "PID", width: "70px", align: "right" },
    { key: "command", label: "Command", width: "minmax(120px, 4fr)" },
    { key: "status", label: "Status", width: "75px", hideOnWindows: true },
    { key: "user", label: "User", width: "80px" },
    { key: "threads", label: "NT", tooltip: "Num Threads", width: "55px", align: "right", hideOnWindows: true },
    { key: "cpu", label: "CPU%", width: "70px", align: "right" },
    { key: "mem", label: "Memory", width: "90px", align: "right" },
];

function getColumns(isWindows: boolean): ColDef[] {
    if (!isWindows) return Columns;
    return Columns.filter((c) => !c.hideOnWindows);
}

function getGridTemplate(isWindows: boolean): string {
    return getColumns(isWindows)
        .map((c) => c.width)
        .join(" ");
}

// ---- components ----

const SortIndicator = React.memo(function SortIndicator({ active, desc }: { active: boolean; desc: boolean }) {
    if (!active) return null;
    return <span className="ml-1 text-[10px]">{desc ? "↓" : "↑"}</span>;
});
SortIndicator.displayName = "SortIndicator";

const TableHeader = React.memo(function TableHeader({
    model,
    sortBy,
    sortDesc,
    isWindows,
}: {
    model: ProcessViewerViewModel;
    sortBy: SortCol;
    sortDesc: boolean;
    isWindows: boolean;
}) {
    const cols = getColumns(isWindows);
    const gridTemplate = getGridTemplate(isWindows);
    return (
        <div
            className="grid w-full shrink-0 border-b border-white/10 bg-panel text-xs text-secondary font-medium select-none"
            style={{ gridTemplateColumns: gridTemplate }}
        >
            {cols.map((col) => (
                <div
                    key={col.key}
                    title={col.tooltip}
                    className={`px-2 py-1 cursor-pointer hover:text-primary hover:bg-white/5 transition-colors truncate flex items-center${col.align === "right" ? " justify-end" : ""}`}
                    onClick={() => model.setSort(col.key)}
                >
                    <span className="truncate">{col.label}</span>
                    <SortIndicator active={sortBy === col.key} desc={sortDesc} />
                </div>
            ))}
        </div>
    );
});
TableHeader.displayName = "TableHeader";

const ProcessRow = React.memo(function ProcessRow({
    proc,
    hasCpu,
    isWindows,
}: {
    proc: ProcessInfo;
    hasCpu: boolean;
    isWindows: boolean;
}) {
    const gridTemplate = getGridTemplate(isWindows);
    return (
        <div
            className="grid w-full text-xs hover:bg-white/5 transition-colors"
            style={{ gridTemplateColumns: gridTemplate, height: RowHeight }}
        >
            <div className="px-2 py-[3px] truncate text-right text-secondary font-mono text-[11px]">{proc.pid}</div>
            <div className="px-2 py-[3px] truncate">{proc.command}</div>
            {!isWindows && <div className="px-2 py-[3px] truncate text-secondary text-[11px]">{proc.status}</div>}
            <div className="px-2 py-[3px] truncate text-secondary">{proc.user}</div>
            {!isWindows && (
                <div className="px-2 py-[3px] truncate text-right text-secondary font-mono text-[11px]">
                    {proc.numthreads > 1 ? proc.numthreads : ""}
                </div>
            )}
            <div className="px-2 py-[3px] truncate text-right font-mono text-[11px]">
                {hasCpu && proc.cpu != null ? fmtCpu(proc.cpu) : ""}
            </div>
            <div className="px-2 py-[3px] truncate text-right font-mono text-[11px]">{fmtMem(proc.mem)}</div>
        </div>
    );
});
ProcessRow.displayName = "ProcessRow";

export const ProcessViewerView: React.FC<ViewComponentProps<ProcessViewerViewModel>> = React.memo(
    function ProcessViewerView({ blockId: _blockId, blockRef: _blockRef, contentRef: _contentRef, model }) {
        const data = jotai.useAtomValue(model.dataAtom);
        const sortBy = jotai.useAtomValue(model.sortByAtom);
        const sortDesc = jotai.useAtomValue(model.sortDescAtom);
        const loading = jotai.useAtomValue(model.loadingAtom);
        const error = jotai.useAtomValue(model.errorAtom);
        const scrollTop = jotai.useAtomValue(model.scrollTopAtom);
        const scrollRef = React.useRef<HTMLDivElement>(null);
        const containerRef = React.useRef<HTMLDivElement>(null);

        const totalCount = data?.totalcount ?? 0;
        const filteredCount = data?.filteredcount ?? 0;
        const processes = data?.processes ?? [];
        const hasCpu = data?.hascpu ?? false;
        const isWindows = data?.iswindows ?? false;
        const startIdx = Math.max(0, Math.floor(scrollTop / RowHeight) - OverscanRows);

        // track container height
        React.useEffect(() => {
            const el = containerRef.current;
            if (!el) return;
            const ro = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    model.setContainerHeight(entry.contentRect.height);
                }
            });
            ro.observe(el);
            model.setContainerHeight(el.clientHeight);
            return () => ro.disconnect();
        }, [model]);

        const handleScroll = React.useCallback(() => {
            const el = scrollRef.current;
            if (!el) return;
            model.setScrollTop(el.scrollTop);
        }, [model]);

        const totalHeight = totalCount * RowHeight;
        const paddingTop = startIdx * RowHeight;

        const summary = data?.summary;
        const memUsedGb = summary?.memused != null ? (summary.memused / 1024 / 1024 / 1024).toFixed(1) : null;
        const memTotalGb = summary?.memtotal != null ? (summary.memtotal / 1024 / 1024 / 1024).toFixed(1) : null;

        return (
            <div className="flex flex-col w-full h-full overflow-hidden" ref={containerRef}>
                {/* status bar */}
                <div className="flex shrink-0 items-center gap-4 px-2 py-1 text-xs text-secondary border-b border-white/10 bg-panel">
                    {summary != null && (
                        <>
                            {summary.load1 != null && (
                                <span>
                                    Load: {summary.load1.toFixed(2)} {summary.load5.toFixed(2)}{" "}
                                    {summary.load15.toFixed(2)}
                                </span>
                            )}
                            {memUsedGb != null && (
                                <span>
                                    Mem: {memUsedGb}G / {memTotalGb}G
                                </span>
                            )}
                        </>
                    )}
                    <span className="ml-auto">
                        {totalCount > 0
                            ? filteredCount < totalCount
                                ? `${filteredCount} / ${totalCount} processes`
                                : `${totalCount} processes`
                            : loading
                              ? "Loading…"
                              : error
                                ? "Error"
                                : ""}
                    </span>
                </div>

                {/* error */}
                {error != null && <div className="px-3 py-2 text-xs text-error shrink-0">{error}</div>}

                {/* header */}
                <TableHeader model={model} sortBy={sortBy} sortDesc={sortDesc} isWindows={isWindows} />

                {/* virtualized rows */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto" onScroll={handleScroll}>
                    <div style={{ height: totalHeight, position: "relative", minWidth: "100%" }}>
                        <div style={{ position: "absolute", top: paddingTop, left: 0, right: 0, minWidth: "100%" }}>
                            {processes.map((proc) => (
                                <ProcessRow key={proc.pid} proc={proc} hasCpu={hasCpu} isWindows={isWindows} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
);
ProcessViewerView.displayName = "ProcessViewerView";
