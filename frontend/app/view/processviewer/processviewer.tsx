// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
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

function formatNumber4(n: number): string {
    if (n < 10) return n.toFixed(2);
    if (n < 100) return n.toFixed(1);
    return Math.floor(n).toString().padStart(4);
}

function fmtMem(bytes: number): string {
    if (bytes == null) return "";
    if (bytes < 1024) return formatNumber4(bytes) + " B";
    if (bytes < 1024 * 1024) return formatNumber4(bytes / 1024) + " K";
    if (bytes < 1024 * 1024 * 1024) return formatNumber4(bytes / 1024 / 1024) + " M";
    return formatNumber4(bytes / 1024 / 1024 / 1024) + " G";
}

function fmtCpu(cpu: number): string {
    if (cpu == null) return "";
    return cpu.toFixed(1) + "%";
}

function fmtLoad(load: number): string {
    if (load == null) return "    ";
    return formatNumber4(load);
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
    lastSuccessAtom: jotai.PrimitiveAtom<number>;
    pausedAtom: jotai.PrimitiveAtom<boolean>;

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
        this.lastSuccessAtom = jotai.atom<number>(0) as jotai.PrimitiveAtom<number>;
        this.pausedAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;

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
                        globalStore.set(this.lastSuccessAtom, Date.now());
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
        if (!globalStore.get(this.pausedAtom)) {
            this.startPolling();
        }
    }

    setPaused(paused: boolean) {
        globalStore.set(this.pausedAtom, paused);
        if (paused) {
            if (this.cancelPoll) {
                this.cancelPoll();
            }
            this.cancelPoll = null;
        } else {
            this.startPolling();
        }
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
    hideOnPlatform?: string[];
};

const Columns: ColDef[] = [
    { key: "pid", label: "PID", width: "70px", align: "right" },
    { key: "command", label: "Command", width: "minmax(120px, 4fr)" },
    { key: "status", label: "Status", width: "75px", hideOnPlatform: ["windows", "darwin"] },
    { key: "user", label: "User", width: "80px" },
    { key: "threads", label: "NT", tooltip: "Num Threads", width: "55px", align: "right", hideOnPlatform: ["windows"] },
    { key: "cpu", label: "CPU%", width: "70px", align: "right" },
    { key: "mem", label: "Memory", width: "90px", align: "right" },
];

function getColumns(platform: string): ColDef[] {
    return Columns.filter((c) => !c.hideOnPlatform?.includes(platform));
}

function getGridTemplate(platform: string): string {
    return getColumns(platform)
        .map((c) => c.width)
        .join(" ");
}

// ---- components ----

const SortIndicator = React.memo(function SortIndicator({ active, desc }: { active: boolean; desc: boolean }) {
    if (!active) return null;
    return <span className="ml-1 text-[10px]">{desc ? "↓" : "↑"}</span>;
});
SortIndicator.displayName = "SortIndicator";

const StatusIndicator = React.memo(function StatusIndicator({ model }: { model: ProcessViewerViewModel }) {
    const paused = jotai.useAtomValue(model.pausedAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const lastSuccess = jotai.useAtomValue(model.lastSuccessAtom);
    const [now, setNow] = React.useState(() => Date.now());

    React.useEffect(() => {
        if (paused) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [paused]);

    if (paused) {
        const tooltipContent = (
            <div className="flex flex-col gap-0.5">
                <span>Paused</span>
                <span className="text-muted">Click to resume</span>
            </div>
        );
        return (
            <Tooltip content={tooltipContent} placement="bottom">
                <div
                    className="flex items-center justify-center w-4 h-4 cursor-pointer text-warning hover:opacity-80 transition-opacity"
                    onClick={() => model.setPaused(false)}
                >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                        <rect x="2" y="2" width="4" height="12" rx="1" />
                        <rect x="10" y="2" width="4" height="12" rx="1" />
                    </svg>
                </div>
            </Tooltip>
        );
    }

    const stalled = lastSuccess > 0 && now - lastSuccess > 5000;
    const circleColor = error != null ? "text-error" : stalled ? "text-warning" : "text-success";
    const statusLabel = error != null ? "Error" : stalled ? "Stalled" : "Updating";
    const tooltipContent = (
        <div className="flex flex-col gap-0.5">
            <span>{statusLabel}</span>
            <span className="text-muted">Click to pause</span>
        </div>
    );

    return (
        <Tooltip content={tooltipContent} placement="bottom">
            <div
                className={`flex items-center justify-center w-4 h-4 cursor-pointer ${circleColor} hover:opacity-80 transition-opacity`}
                onClick={() => model.setPaused(true)}
            >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <circle cx="8" cy="8" r="6" />
                </svg>
            </div>
        </Tooltip>
    );
});
StatusIndicator.displayName = "StatusIndicator";

const TableHeader = React.memo(function TableHeader({
    model,
    sortBy,
    sortDesc,
    platform,
}: {
    model: ProcessViewerViewModel;
    sortBy: SortCol;
    sortDesc: boolean;
    platform: string;
}) {
    const cols = getColumns(platform);
    const gridTemplate = getGridTemplate(platform);
    return (
        <div
            className="grid w-full shrink-0 border-b border-white/10 bg-panel text-xs text-secondary font-medium select-none"
            style={{ gridTemplateColumns: gridTemplate }}
        >
            {cols.map((col) => (
                <Tooltip
                    key={col.key}
                    content={col.tooltip}
                    disable={!col.tooltip}
                    divClassName={`px-2 py-1 cursor-pointer hover:text-primary hover:bg-white/5 transition-colors truncate flex items-center${col.align === "right" ? " justify-end" : ""}`}
                    divOnClick={() => model.setSort(col.key)}
                >
                    <span className="truncate">{col.label}</span>
                    <SortIndicator active={sortBy === col.key} desc={sortDesc} />
                </Tooltip>
            ))}
        </div>
    );
});
TableHeader.displayName = "TableHeader";

const ProcessRow = React.memo(function ProcessRow({
    proc,
    hasCpu,
    platform,
}: {
    proc: ProcessInfo;
    hasCpu: boolean;
    platform: string;
}) {
    const gridTemplate = getGridTemplate(platform);
    const showStatus = platform !== "windows" && platform !== "darwin";
    const showThreads = platform !== "windows";
    return (
        <div
            className="grid w-full text-xs hover:bg-white/5 transition-colors"
            style={{ gridTemplateColumns: gridTemplate, height: RowHeight }}
        >
            <div className="px-2 py-[3px] truncate text-right text-secondary font-mono text-[11px]">{proc.pid}</div>
            <div className="px-2 py-[3px] truncate">{proc.command}</div>
            {showStatus && <div className="px-2 py-[3px] truncate text-secondary text-[11px]">{proc.status}</div>}
            <div className="px-2 py-[3px] truncate text-secondary">{proc.user}</div>
            {showThreads && (
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
        const platform = data?.platform ?? "";
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
        const memUsedFmt = summary?.memused != null ? fmtMem(summary.memused) : null;
        const memTotalFmt = summary?.memtotal != null ? fmtMem(summary.memtotal) : null;
        const cpuPct =
            summary?.cpusum != null && summary?.numcpu != null && summary.numcpu > 0
                ? (summary.cpusum / summary.numcpu).toFixed(1).padStart(6, " ")
                : null;

        const procCountValue =
            totalCount > 0
                ? filteredCount < totalCount
                    ? `${filteredCount} / ${totalCount}`
                    : String(totalCount).padStart(5, " ")
                : loading
                  ? "…"
                  : error
                    ? "Err"
                    : "";

        const hasSummaryLoad = summary != null && summary.load1 != null;
        const hasSummaryMem = summary != null && memUsedFmt != null;
        const hasSummaryCpu = summary != null && cpuPct != null;

        return (
            <div className="flex flex-col w-full h-full overflow-hidden" ref={containerRef}>
                {/* status bar */}
                <div className="shrink-0 text-xs text-secondary border-b border-white/10 bg-panel">
                    <div className="flex items-center gap-4 px-2 pt-1 pb-0">
                        <StatusIndicator model={model} />
                        {hasSummaryLoad && <span className="w-[120px] shrink-0">Load</span>}
                        {hasSummaryMem && <span className="w-[120px] shrink-0">Mem</span>}
                        {hasSummaryCpu && (
                            <Tooltip content={`${summary.numcpu} cores`} placement="bottom">
                                <span className="w-[70px] shrink-0 cursor-default">
                                    CPU<span className="font-mono text-[11px]">x{summary.numcpu}</span>
                                </span>
                            </Tooltip>
                        )}
                        <span className="ml-auto">Procs</span>
                    </div>
                    <div className="flex items-center gap-4 px-2 pb-1 pt-0">
                        <div className="w-4 shrink-0" />
                        {hasSummaryLoad && (
                            <span className="font-mono text-[11px] w-[120px] shrink-0 whitespace-pre">
                                {fmtLoad(summary.load1)} {fmtLoad(summary.load5)} {fmtLoad(summary.load15)}
                            </span>
                        )}
                        {hasSummaryMem && (
                            <span className="font-mono text-[11px] w-[120px] shrink-0 whitespace-pre">
                                {memUsedFmt} / {memTotalFmt}
                            </span>
                        )}
                        {hasSummaryCpu && (
                            <span className="font-mono text-[11px] w-[70px] shrink-0 whitespace-pre">{cpuPct}%</span>
                        )}
                        <span className="ml-auto font-mono text-[11px] whitespace-pre">{procCountValue}</span>
                    </div>
                </div>

                {/* error */}
                {error != null && <div className="px-3 py-2 text-xs text-error shrink-0">{error}</div>}

                {/* header */}
                <TableHeader model={model} sortBy={sortBy} sortDesc={sortDesc} platform={platform} />

                {/* virtualized rows */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto" onScroll={handleScroll}>
                    <div style={{ height: totalHeight, position: "relative", minWidth: "100%" }}>
                        <div style={{ position: "absolute", top: paddingTop, left: 0, right: 0, minWidth: "100%" }}>
                            {processes.map((proc) => (
                                <ProcessRow key={proc.pid} proc={proc} hasCpu={hasCpu} platform={platform} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
);
ProcessViewerView.displayName = "ProcessViewerView";
