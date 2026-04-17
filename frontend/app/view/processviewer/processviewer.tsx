// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import * as keyutil from "@/util/keyutil";
import { isMacOS } from "@/util/platformutil";
import { isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";

// ---- types ----

type ActionStatus = {
    pid: number;
    message: string;
    isError: boolean;
};

type ProcessViewerEnv = WaveEnvSubset<{
    rpc: {
        RemoteProcessListCommand: WaveEnv["rpc"]["RemoteProcessListCommand"];
        RemoteProcessSignalCommand: WaveEnv["rpc"]["RemoteProcessSignalCommand"];
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
    if (bytes === -1) return "-";
    if (bytes < 1024) return formatNumber4(bytes) + "B";
    if (bytes < 1024 * 1024) return formatNumber4(bytes / 1024) + "K";
    if (bytes < 1024 * 1024 * 1024) return formatNumber4(bytes / 1024 / 1024) + "M";
    return formatNumber4(bytes / 1024 / 1024 / 1024) + "G";
}

function fmtCpu(cpu: number): string {
    if (cpu == null) return "";
    if (cpu === -1) return "   -";
    if (cpu === 0) return " 0.0%";
    if (cpu < 0.005) return "~0.0%";
    if (cpu < 10) return cpu.toFixed(2) + "%";
    if (cpu < 100) return cpu.toFixed(1) + "%";
    if (cpu < 1000) return " " + Math.floor(cpu).toString() + "%";
    return Math.floor(cpu).toString() + "%";
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
    dataStartAtom: jotai.PrimitiveAtom<number>;
    sortByAtom: jotai.PrimitiveAtom<SortCol>;
    sortDescAtom: jotai.PrimitiveAtom<boolean>;
    scrollTopAtom: jotai.PrimitiveAtom<number>;
    containerHeightAtom: jotai.PrimitiveAtom<number>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    lastSuccessAtom: jotai.PrimitiveAtom<number>;
    pausedAtom: jotai.PrimitiveAtom<boolean>;
    selectedPidAtom: jotai.PrimitiveAtom<number>;
    actionStatusAtom: jotai.PrimitiveAtom<ActionStatus>;
    textSearchAtom: jotai.PrimitiveAtom<string>;
    searchOpenAtom: jotai.PrimitiveAtom<boolean>;
    fetchIntervalAtom: jotai.PrimitiveAtom<number>;

    connection: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;

    disposed = false;
    cancelPoll: (() => void) | null = null;
    fetchEpoch = 0;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "processviewer";
        this.blockId = blockId;
        this.env = waveEnv;

        this.dataAtom = jotai.atom<ProcessListResponse>(null) as jotai.PrimitiveAtom<ProcessListResponse>;
        this.dataStartAtom = jotai.atom<number>(0);
        this.sortByAtom = jotai.atom<SortCol>("cpu");
        this.sortDescAtom = jotai.atom<boolean>(true);
        this.scrollTopAtom = jotai.atom<number>(0);
        this.containerHeightAtom = jotai.atom<number>(0);
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
        this.lastSuccessAtom = jotai.atom<number>(0) as jotai.PrimitiveAtom<number>;
        this.pausedAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
        this.selectedPidAtom = jotai.atom<number>(null) as jotai.PrimitiveAtom<number>;
        this.actionStatusAtom = jotai.atom<ActionStatus>(null) as jotai.PrimitiveAtom<ActionStatus>;
        this.textSearchAtom = jotai.atom<string>("") as jotai.PrimitiveAtom<string>;
        this.searchOpenAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
        this.fetchIntervalAtom = jotai.atom<number>(2000) as jotai.PrimitiveAtom<number>;

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

    async doOneFetch(lastPidOrder: boolean, cancelledFn?: () => boolean) {
        if (this.disposed) return;
        const epoch = ++this.fetchEpoch;
        const sortBy = globalStore.get(this.sortByAtom);
        const sortDesc = globalStore.get(this.sortDescAtom);
        const scrollTop = globalStore.get(this.scrollTopAtom);
        const containerHeight = globalStore.get(this.containerHeightAtom);
        const conn = globalStore.get(this.connection);
        const textSearch = globalStore.get(this.textSearchAtom);
        const connStatus = globalStore.get(this.connStatus);

        if (!connStatus?.connected) {
            return;
        }
        const start = Math.max(0, Math.floor(scrollTop / RowHeight) - OverscanRows);
        const visibleRows = containerHeight > 0 ? Math.ceil(containerHeight / RowHeight) : 50;
        const limit = visibleRows + OverscanRows * 2;

        const route = makeConnRoute(conn);
        try {
            const resp = await this.env.rpc.RemoteProcessListCommand(
                TabRpcClient,
                {
                    widgetid: this.blockId,
                    sortby: sortBy,
                    sortdesc: sortDesc,
                    start,
                    limit,
                    textsearch: textSearch || undefined,
                    lastpidorder: lastPidOrder,
                },
                { route }
            );
            if (!this.disposed && !cancelledFn?.() && this.fetchEpoch === epoch) {
                globalStore.set(this.dataAtom, resp);
                globalStore.set(this.dataStartAtom, start);
                globalStore.set(this.loadingAtom, false);
                globalStore.set(this.errorAtom, null);
                globalStore.set(this.lastSuccessAtom, Date.now());
            }
        } catch (e) {
            if (!this.disposed && !cancelledFn?.() && this.fetchEpoch === epoch) {
                globalStore.set(this.loadingAtom, false);
                globalStore.set(this.errorAtom, String(e));
            }
        }
    }

    async doKeepAlive() {
        if (this.disposed) return;
        const connStatus = globalStore.get(this.connStatus);
        if (!connStatus?.connected) {
            return;
        }
        const conn = globalStore.get(this.connection);
        const route = makeConnRoute(conn);
        try {
            await this.env.rpc.RemoteProcessListCommand(
                TabRpcClient,
                { widgetid: this.blockId, keepalive: true },
                { route }
            );
        } catch (_) {
            // keepalive failures are silent
        }
    }

    startPolling() {
        let cancelled = false;
        this.cancelPoll = () => {
            cancelled = true;
        };

        const poll = async () => {
            while (!cancelled && !this.disposed) {
                await this.doOneFetch(false, () => cancelled);

                if (cancelled || this.disposed) break;

                const interval = globalStore.get(this.fetchIntervalAtom);
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, interval);
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

    startKeepAlive() {
        let cancelled = false;
        this.cancelPoll = () => {
            cancelled = true;
        };

        const keepAliveLoop = async () => {
            while (!cancelled && !this.disposed) {
                await this.doKeepAlive();

                if (cancelled || this.disposed) break;

                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 10000);
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

        keepAliveLoop();
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

    forceRefreshOnConnectionChange() {
        if (this.cancelPoll) {
            this.cancelPoll();
        }
        this.cancelPoll = null;
        globalStore.set(this.dataAtom, null);
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.errorAtom, null);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(false);
            this.startKeepAlive();
        } else {
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
            this.startKeepAlive();
        } else {
            if (this.cancelPoll) {
                this.cancelPoll();
            }
            this.cancelPoll = null;
            this.startPolling();
        }
    }

    setTextSearch(text: string) {
        globalStore.set(this.textSearchAtom, text);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(false);
        } else {
            this.triggerRefresh();
        }
    }

    openSearch() {
        globalStore.set(this.searchOpenAtom, true);
    }

    closeSearch() {
        globalStore.set(this.searchOpenAtom, false);
        globalStore.set(this.textSearchAtom, "");
        this.triggerRefresh();
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:f")) {
            this.openSearch();
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Space") && !globalStore.get(this.searchOpenAtom)) {
            this.setPaused(!globalStore.get(this.pausedAtom));
            return true;
        }
        return false;
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
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(false);
        } else {
            this.triggerRefresh();
        }
    }

    setScrollTop(scrollTop: number) {
        const cur = globalStore.get(this.scrollTopAtom);
        if (Math.abs(cur - scrollTop) < RowHeight) return;
        globalStore.set(this.scrollTopAtom, scrollTop);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(true);
        }
    }

    setContainerHeight(height: number) {
        const cur = globalStore.get(this.containerHeightAtom);
        if (cur === height) return;
        globalStore.set(this.containerHeightAtom, height);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(true);
        } else {
            this.triggerRefresh();
        }
    }

    async sendSignal(pid: number, signal: string, killLabel?: boolean) {
        const conn = globalStore.get(this.connection);
        const route = makeConnRoute(conn);
        const label = killLabel ? "Killed" : `sent ${signal}`;
        try {
            await this.env.rpc.RemoteProcessSignalCommand(TabRpcClient, { pid, signal }, { route });
            this.setActionStatus({ pid, message: `Process #${pid} ${label}`, isError: false });
        } catch (e) {
            this.setActionStatus({ pid, message: String(e), isError: true });
        }
    }

    setActionStatus(status: ActionStatus) {
        globalStore.set(this.actionStatusAtom, status);
        if (!status.isError) {
            setTimeout(() => {
                const cur = globalStore.get(this.actionStatusAtom);
                if (cur === status) {
                    globalStore.set(this.actionStatusAtom, null);
                }
            }, 3000);
        }
    }

    clearActionStatus() {
        globalStore.set(this.actionStatusAtom, null);
    }

    setFetchInterval(ms: number) {
        globalStore.set(this.fetchIntervalAtom, ms);
        this.triggerRefresh();
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const currentInterval = globalStore.get(this.fetchIntervalAtom);
        return [
            {
                label: "Refresh Interval",
                type: "submenu",
                submenu: [
                    {
                        label: "1 second",
                        type: "checkbox",
                        checked: currentInterval === 1000,
                        click: () => this.setFetchInterval(1000),
                    },
                    {
                        label: "2 seconds",
                        type: "checkbox",
                        checked: currentInterval === 2000,
                        click: () => this.setFetchInterval(2000),
                    },
                    {
                        label: "5 seconds",
                        type: "checkbox",
                        checked: currentInterval === 5000,
                        click: () => this.setFetchInterval(5000),
                    },
                ],
            },
        ];
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
    { key: "user", label: "User", width: "80px", hideOnPlatform: ["windows"] },
    { key: "threads", label: "NT", tooltip: "Num Threads", width: "40px", align: "right", hideOnPlatform: ["windows"] },
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
    selected,
    onSelect,
    onContextMenu,
}: {
    proc: ProcessInfo;
    hasCpu: boolean;
    platform: string;
    selected: boolean;
    onSelect: (pid: number) => void;
    onContextMenu: (pid: number, e: React.MouseEvent) => void;
}) {
    const cols = getColumns(platform);
    const visibleKeys = new Set(cols.map((c) => c.key));
    const gridTemplate = getGridTemplate(platform);
    if (proc.gone) {
        return (
            <div
                className={`grid w-full text-xs transition-colors cursor-pointer ${selected ? "bg-accentbg" : "hover:bg-white/5"}`}
                style={{ gridTemplateColumns: gridTemplate, height: RowHeight }}
                onClick={() => onSelect(proc.pid)}
                onContextMenu={(e) => onContextMenu(proc.pid, e)}
            >
                <div className="px-2 flex items-center truncate justify-end text-secondary font-mono text-[11px]">
                    {proc.pid}
                </div>
                <div className="px-2 flex items-center truncate text-muted italic">(gone)</div>
                {visibleKeys.has("status") && <div className="px-2 flex items-center truncate" />}
                {visibleKeys.has("user") && <div className="px-2 flex items-center truncate" />}
                {visibleKeys.has("threads") && <div className="px-2 flex items-center truncate" />}
                <div className="px-2 flex items-center truncate" />
                <div className="px-2 flex items-center truncate" />
            </div>
        );
    }
    return (
        <div
            className={`grid w-full text-xs transition-colors cursor-pointer ${selected ? "bg-accentbg" : "hover:bg-white/5"}`}
            style={{ gridTemplateColumns: gridTemplate, height: RowHeight }}
            onClick={() => onSelect(proc.pid)}
            onContextMenu={(e) => onContextMenu(proc.pid, e)}
        >
            <div className="px-2 flex items-center truncate justify-end text-secondary font-mono text-[11px]">
                {proc.pid}
            </div>
            <div className="px-2 flex items-center truncate">{proc.command}</div>
            {visibleKeys.has("status") && (
                <div className="px-2 flex items-center truncate text-secondary text-[11px]">{proc.status}</div>
            )}
            {visibleKeys.has("user") && (
                <div className="px-2 flex items-center truncate text-secondary">{proc.user}</div>
            )}
            {visibleKeys.has("threads") && (
                <div className="px-2 flex items-center truncate justify-end text-secondary font-mono text-[11px]">
                    {proc.numthreads === -1 ? "-" : proc.numthreads >= 1 ? proc.numthreads : ""}
                </div>
            )}
            <div className="px-2 flex items-center truncate justify-end font-mono text-[11px] whitespace-pre">
                {hasCpu ? fmtCpu(proc.cpu) : ""}
            </div>
            <div className="px-2 flex items-center truncate justify-end font-mono text-[11px]">{fmtMem(proc.mem)}</div>
        </div>
    );
});
ProcessRow.displayName = "ProcessRow";

const ActionStatusBar = React.memo(function ActionStatusBar({ model }: { model: ProcessViewerViewModel }) {
    const actionStatus = jotai.useAtomValue(model.actionStatusAtom);
    if (actionStatus == null) return null;

    return (
        <div
            className={`shrink-0 flex items-center px-3 py-1 text-xs border-t border-white/10 ${actionStatus.isError ? "text-error" : "text-secondary"}`}
        >
            <span className="flex-1 truncate">
                {actionStatus.isError ? `Error: ${actionStatus.message}` : actionStatus.message}
            </span>
            {actionStatus.isError && (
                <button
                    className="ml-2 shrink-0 flex items-center justify-center w-4 h-4 rounded hover:bg-white/10 transition-colors cursor-pointer text-secondary hover:text-primary"
                    onClick={() => model.clearActionStatus()}
                >
                    <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                </button>
            )}
        </div>
    );
});
ActionStatusBar.displayName = "ActionStatusBar";

type StatusBarProps = {
    model: ProcessViewerViewModel;
    data: ProcessListResponse;
    loading: boolean;
    error: string;
    wide: boolean;
};

const StatusBar = React.memo(function StatusBar({ model, data, loading, error, wide }: StatusBarProps) {
    const searchOpen = jotai.useAtomValue(model.searchOpenAtom);
    const totalCount = data?.totalcount ?? 0;
    const filteredCount = data?.filteredcount ?? 0;
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
                ? `${filteredCount}/${totalCount}`
                : String(totalCount).padStart(5, " ")
            : loading
              ? "…"
              : error
                ? "Err"
                : "";

    const hasSummaryLoad = summary != null && summary.load1 != null;
    const hasSummaryMem = summary != null && memUsedFmt != null;
    const hasSummaryCpu = summary != null && cpuPct != null;

    const searchTooltip = isMacOS() ? "Search (Cmd-F)" : "Search (Alt-F)";

    if (wide) {
        return (
            <div className="shrink-0 text-xs text-secondary border-b border-white/10 bg-panel flex items-center gap-2 px-2 py-1">
                <div className="shrink-0 flex items-center">
                    <StatusIndicator model={model} />
                </div>
                {hasSummaryLoad && (
                    <span className="shrink-0 whitespace-pre">
                        Load{" "}
                        <span className="font-mono text-[11px]">
                            {fmtLoad(summary.load1)} {fmtLoad(summary.load5)} {fmtLoad(summary.load15)}
                        </span>
                    </span>
                )}
                {hasSummaryMem && (
                    <>
                        <div className="w-px self-stretch bg-white/10 shrink-0" />
                        <span className="shrink-0 whitespace-pre">
                            Mem{" "}
                            <span className="font-mono text-[11px]">
                                {memUsedFmt} / {memTotalFmt}
                            </span>
                        </span>
                    </>
                )}
                {hasSummaryCpu && (
                    <>
                        <div className="w-px self-stretch bg-white/10 shrink-0" />
                        <Tooltip
                            content={`100% per core · ${summary.numcpu} ${summary.numcpu === 1 ? "core" : "cores"} = ${summary.numcpu * 100}% max`}
                            placement="bottom"
                        >
                            <span className="shrink-0 cursor-default whitespace-pre">
                                CPU<span className="font-mono text-[11px]">x{summary.numcpu}</span>{" "}
                                <span className="font-mono text-[11px]">{cpuPct}%</span>
                            </span>
                        </Tooltip>
                    </>
                )}
                <span className="ml-auto whitespace-pre">
                    Procs <span className="font-mono text-[11px]">{procCountValue}</span>
                </span>
                <Tooltip content={searchTooltip} placement="bottom">
                    <button
                        className={`shrink-0 flex items-center justify-center w-4 h-4 rounded hover:bg-white/10 transition-colors cursor-pointer hover:text-primary ${searchOpen ? "text-primary" : "text-secondary"}`}
                        onClick={() => (searchOpen ? model.closeSearch() : model.openSearch())}
                    >
                        <i className="fa-sharp fa-solid fa-magnifying-glass text-[10px]" />
                    </button>
                </Tooltip>
            </div>
        );
    }

    return (
        <div className="shrink-0 text-xs text-secondary border-b border-white/10 bg-panel flex items-center px-2 py-1">
            <div className="shrink-0 flex items-center mr-1">
                <StatusIndicator model={model} />
            </div>
            <div className="flex-1 max-w-3" />
            <div className="flex flex-row flex-1 min-w-0 items-center">
                {hasSummaryLoad && (
                    <div className="flex flex-col shrink-0 w-[100px] mr-1">
                        <div>Load</div>
                        <div className="font-mono text-[11px] whitespace-pre">
                            {fmtLoad(summary.load1)} {fmtLoad(summary.load5)} {fmtLoad(summary.load15)}
                        </div>
                    </div>
                )}
                {hasSummaryLoad && <div className="flex-1 max-w-3" />}
                {hasSummaryMem && (
                    <div className="flex flex-col shrink-0 w-[95px] mr-1">
                        <div>Mem</div>
                        <div className="font-mono text-[11px] whitespace-pre">
                            {memUsedFmt} / {memTotalFmt}
                        </div>
                    </div>
                )}
                {hasSummaryMem && <div className="flex-1 max-w-3" />}
                {hasSummaryCpu && (
                    <div className="flex flex-col shrink-0 w-[55px] mr-1">
                        <Tooltip
                            content={`100% per core · ${summary.numcpu} ${summary.numcpu === 1 ? "core" : "cores"} = ${summary.numcpu * 100}% max`}
                            placement="bottom"
                        >
                            <div className="cursor-default">
                                CPU<span className="font-mono text-[11px]">x{summary.numcpu}</span>
                            </div>
                        </Tooltip>
                        <div className="font-mono text-[11px] whitespace-pre">{cpuPct}%</div>
                    </div>
                )}
                {hasSummaryCpu && <div className="flex-1 max-w-3" />}
                <div className="flex-1" />
                <div className="flex flex-col w-[38px] shrink-0">
                    <div>Procs</div>
                    <div className="font-mono text-[11px] whitespace-pre">{procCountValue}</div>
                </div>
                <Tooltip content={searchTooltip} placement="bottom">
                    <button
                        className={`shrink-0 ml-1 flex items-center justify-center w-4 h-4 rounded hover:bg-white/10 transition-colors cursor-pointer hover:text-primary ${searchOpen ? "text-primary" : "text-secondary"}`}
                        onClick={() => (searchOpen ? model.closeSearch() : model.openSearch())}
                    >
                        <i className="fa-sharp fa-solid fa-magnifying-glass text-[10px]" />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
});
StatusBar.displayName = "StatusBar";

const SearchBar = React.memo(function SearchBar({ model }: { model: ProcessViewerViewModel }) {
    const searchOpen = jotai.useAtomValue(model.searchOpenAtom);
    const textSearch = jotai.useAtomValue(model.textSearchAtom);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (searchOpen && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [searchOpen]);

    if (!searchOpen) return null;

    return (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-white/10 bg-panel">
            <input
                ref={inputRef}
                type="text"
                value={textSearch}
                placeholder="Filter processes…"
                className="flex-1 bg-transparent text-xs text-primary placeholder-secondary outline-none min-w-0"
                onChange={(e) => model.setTextSearch(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        e.preventDefault();
                        model.closeSearch();
                    }
                }}
            />
            <button
                className="shrink-0 flex items-center justify-center w-4 h-4 rounded hover:bg-white/10 transition-colors cursor-pointer text-secondary hover:text-primary"
                onClick={() => model.closeSearch()}
            >
                <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
            </button>
        </div>
    );
});
SearchBar.displayName = "SearchBar";

export const ProcessViewerView: React.FC<ViewComponentProps<ProcessViewerViewModel>> = React.memo(
    function ProcessViewerView({ blockId: _blockId, blockRef: _blockRef, contentRef: _contentRef, model }) {
        const data = jotai.useAtomValue(model.dataAtom);
        const sortBy = jotai.useAtomValue(model.sortByAtom);
        const sortDesc = jotai.useAtomValue(model.sortDescAtom);
        const loading = jotai.useAtomValue(model.loadingAtom);
        const error = jotai.useAtomValue(model.errorAtom);
        const [selectedPid, setSelectedPid] = jotai.useAtom(model.selectedPidAtom);
        const dataStart = jotai.useAtomValue(model.dataStartAtom);
        const connection = jotai.useAtomValue(model.connection);
        const connStatus = jotai.useAtomValue(model.connStatus);
        const bodyScrollRef = React.useRef<HTMLDivElement>(null);
        const containerRef = React.useRef<HTMLDivElement>(null);
        const [wide, setWide] = React.useState(false);

        const isFirstRender = React.useRef(true);
        React.useEffect(() => {
            if (isFirstRender.current) {
                isFirstRender.current = false;
                return;
            }
            model.forceRefreshOnConnectionChange();
        }, [connection]);

        const handleSelectPid = React.useCallback(
            (pid: number) => {
                setSelectedPid((cur) => (cur === pid ? null : pid));
            },
            [setSelectedPid]
        );

        const handleContextMenu = React.useCallback(
            (pid: number, e: React.MouseEvent) => {
                e.preventDefault();
                model.setPaused(true);
                setSelectedPid(pid);

                const platform = globalStore.get(model.dataAtom)?.platform ?? "";
                const isWindows = platform === "windows";

                const menu: ContextMenuItem[] = [
                    {
                        label: "Copy PID",
                        click: () => navigator.clipboard.writeText(String(pid)),
                    },
                    { type: "separator" },
                ];

                if (!isWindows) {
                    menu.push({
                        label: "Signal",
                        type: "submenu",
                        submenu: [
                            { label: "SIGTERM", click: () => model.sendSignal(pid, "SIGTERM") },
                            { label: "SIGINT", click: () => model.sendSignal(pid, "SIGINT") },
                            { label: "SIGHUP", click: () => model.sendSignal(pid, "SIGHUP") },
                            { label: "SIGKILL", click: () => model.sendSignal(pid, "SIGKILL") },
                            { label: "SIGUSR1", click: () => model.sendSignal(pid, "SIGUSR1") },
                            { label: "SIGUSR2", click: () => model.sendSignal(pid, "SIGUSR2") },
                        ],
                    });
                    menu.push({ type: "separator" });
                    menu.push({
                        label: "Kill Process",
                        click: () => model.sendSignal(pid, "SIGTERM", true),
                    });
                }

                menu.push({ type: "separator" });
                menu.push(...model.getSettingsMenuItems());

                ContextMenuModel.getInstance().showContextMenu(menu, e);
            },
            [model, setSelectedPid]
        );

        const platform = data?.platform ?? "";
        const totalCount = data?.totalcount ?? 0;
        const filteredCount = data?.filteredcount ?? totalCount;
        const processes = data?.processes ?? [];
        const hasCpu = data?.hascpu ?? false;

        React.useEffect(() => {
            const el = containerRef.current;
            if (!el) return;
            const ro = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    model.setContainerHeight(entry.contentRect.height);
                    setWide(entry.contentRect.width >= 600);
                }
            });
            ro.observe(el);
            model.setContainerHeight(el.clientHeight);
            setWide(el.clientWidth >= 600);
            return () => ro.disconnect();
        }, [model]);

        const handleScroll = React.useCallback(() => {
            const el = bodyScrollRef.current;
            if (!el) return;
            model.setScrollTop(el.scrollTop);
        }, [model]);

        const totalHeight = filteredCount * RowHeight;
        const paddingTop = dataStart * RowHeight;

        return (
            <div className="flex flex-col w-full h-full overflow-hidden" ref={containerRef}>
                <StatusBar model={model} data={data} loading={loading} error={error} wide={wide} />
                <SearchBar model={model} />

                {/* error */}
                {error != null && <div className="px-3 py-2 text-xs text-error shrink-0">{error}</div>}

                {/* outer h-scroll wrapper */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden">
                    {!connStatus?.connected ? (
                        <div className="flex items-center justify-center h-full text-secondary text-sm">
                            Waiting for connection…
                        </div>
                    ) : (
                        <div className="flex flex-col h-full min-w-full w-max">
                            <TableHeader model={model} sortBy={sortBy} sortDesc={sortDesc} platform={platform} />
                            <div
                                ref={bodyScrollRef}
                                className="flex-1 overflow-y-auto overflow-x-hidden w-full wide-scrollbar"
                                onScroll={handleScroll}
                            >
                                <div style={{ height: totalHeight, position: "relative" }}>
                                    <div style={{ position: "absolute", top: paddingTop, left: 0, right: 0 }}>
                                        {processes.map((proc) => (
                                            <ProcessRow
                                                key={proc.pid}
                                                proc={proc}
                                                hasCpu={hasCpu}
                                                platform={platform}
                                                selected={selectedPid === proc.pid}
                                                onSelect={handleSelectPid}
                                                onContextMenu={handleContextMenu}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <ActionStatusBar model={model} />
            </div>
        );
    }
);
ProcessViewerView.displayName = "ProcessViewerView";
