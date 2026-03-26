// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { Container, ContainerManagerViewModel, CpuPoint, LogLine } from "./containers-model";
import "./containers.scss";

function formatAge(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
}

function StatusBadge({ status }: { status: Container["status"] }) {
    return <span className={`containers-widget__status-badge containers-widget__status-badge--${status}`}>{status}</span>;
}

function CpuSparkline({ points }: { points: CpuPoint[] }) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || points.length < 2) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const values = points.map((p) => p.value);
        const minV = 0;
        const maxV = 100;
        const range = maxV - minV;
        const toX = (i: number) => (i / (points.length - 1)) * w;
        const toY = (v: number) => h - ((v - minV) / range) * (h - 8) - 4;

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(13,183,237,0.35)");
        grad.addColorStop(1, "rgba(13,183,237,0)");
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(values[0]));
        for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
        ctx.lineTo(toX(values.length - 1), h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = "#0db7ed";
        ctx.lineWidth = 1.5;
        ctx.moveTo(toX(0), toY(values[0]));
        for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
        ctx.stroke();
    }, [points]);
    return <canvas ref={canvasRef} className="containers-widget__cpu-sparkline" width={280} height={60} />;
}

function ContainersTab({ model }: { model: ContainerManagerViewModel }) {
    const containers = useAtomValue(model.containers);
    const [search, setSearch] = useAtom(model.searchFilter);
    const [statusFilter, setStatusFilter] = useAtom(model.statusFilter);

    const filtered = containers.filter((c) => {
        const matchName = c.name.toLowerCase().includes(search.toLowerCase()) || c.image.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "all" || c.status === statusFilter;
        return matchName && matchStatus;
    });

    return (
        <div className="containers-widget__tab-content">
            <div className="containers-widget__toolbar">
                <input
                    className="containers-widget__search"
                    type="text"
                    placeholder="Search name or image…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="containers-widget__select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                >
                    <option value="all">All Status</option>
                    <option value="running">Running</option>
                    <option value="stopped">Stopped</option>
                    <option value="error">Error</option>
                </select>
                <button className="containers-widget__btn containers-widget__btn--primary">+ New Container</button>
            </div>

            <div className="containers-widget__section">
                <div className="containers-widget__table">
                    <div className="containers-widget__table-header">
                        <span>Name</span>
                        <span>Image</span>
                        <span>Status</span>
                        <span>CPU</span>
                        <span>Memory</span>
                        <span>Ports</span>
                        <span>Age</span>
                        <span>Actions</span>
                    </div>
                    {filtered.map((c) => (
                        <div key={c.id} className="containers-widget__table-row">
                            <span className="containers-widget__container-name">{c.name}</span>
                            <span className="containers-widget__container-image">{c.image}</span>
                            <StatusBadge status={c.status} />
                            <span className={`containers-widget__cpu ${c.cpu > 30 ? "containers-widget__cpu--high" : ""}`}>
                                {c.cpu.toFixed(1)}%
                            </span>
                            <span>{c.memMB > 0 ? `${c.memMB}MB` : "—"}</span>
                            <span className="containers-widget__ports">{c.ports || "—"}</span>
                            <span className="containers-widget__age">{formatAge(c.created)}</span>
                            <div className="containers-widget__actions">
                                {c.status === "running" ? (
                                    <button
                                        className="containers-widget__action-btn containers-widget__action-btn--stop"
                                        title="Stop"
                                        onClick={() => model.toggleContainerStatus(c.id)}
                                    >
                                        ■
                                    </button>
                                ) : (
                                    <button
                                        className="containers-widget__action-btn containers-widget__action-btn--start"
                                        title="Start"
                                        onClick={() => model.toggleContainerStatus(c.id)}
                                    >
                                        ▶
                                    </button>
                                )}
                                <button
                                    className="containers-widget__action-btn containers-widget__action-btn--restart"
                                    title="Restart"
                                    onClick={() => model.restartContainer(c.id)}
                                >
                                    ↺
                                </button>
                                <button
                                    className="containers-widget__action-btn containers-widget__action-btn--remove"
                                    title="Remove"
                                    onClick={() => model.removeContainer(c.id)}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div className="containers-widget__empty">No containers match the current filter.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function LogsTab({ model }: { model: ContainerManagerViewModel }) {
    const containers = useAtomValue(model.containers);
    const [selectedContainer, setSelectedContainer] = useAtom(model.selectedLogContainer);
    const logLines = useAtomValue(model.logLines);
    const [follow, setFollow] = useAtom(model.followLogs);
    const logEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (follow && logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logLines, follow]);

    function handleContainerChange(name: string) {
        setSelectedContainer(name);
        model.setLogContainer(name);
    }

    function formatTs(ts: number): string {
        return new Date(ts).toISOString().replace("T", " ").slice(0, 23);
    }

    return (
        <div className="containers-widget__tab-content">
            <div className="containers-widget__toolbar">
                <select
                    className="containers-widget__select"
                    value={selectedContainer}
                    onChange={(e) => handleContainerChange(e.target.value)}
                >
                    {containers.map((c) => (
                        <option key={c.id} value={c.name}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <label className="containers-widget__toggle-label">
                    <input
                        type="checkbox"
                        checked={follow}
                        onChange={(e) => setFollow(e.target.checked)}
                    />
                    Follow
                </label>
                <button className="containers-widget__btn" onClick={() => model.clearLogs()}>
                    Clear
                </button>
                <button className="containers-widget__btn">Download</button>
                <span className="containers-widget__line-count">{logLines.length} lines</span>
            </div>

            <div className="containers-widget__log-pane">
                {logLines.map((line, i) => (
                    <div key={i} className={`containers-widget__log-line containers-widget__log-line--${line.level.toLowerCase()}`}>
                        <span className="containers-widget__log-ts">{formatTs(line.ts)}</span>
                        <span className="containers-widget__log-level">{line.level}</span>
                        <span className="containers-widget__log-msg">{line.message}</span>
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>
        </div>
    );
}

function MetricsTab({ model }: { model: ContainerManagerViewModel }) {
    const containers = useAtomValue(model.containers);
    const [selectedContainer, setSelectedContainer] = useAtom(model.selectedMetricsContainer);
    const cpuHistory = useAtomValue(model.cpuHistory);

    const container = containers.find((c) => c.name === selectedContainer);
    const running = containers.filter((c) => c.status === "running");
    const stopped = containers.filter((c) => c.status === "stopped");
    const totalMem = running.reduce((s, c) => s + c.memMB, 0);

    const currentCpu = cpuHistory[cpuHistory.length - 1]?.value ?? 0;
    const memPct = container ? Math.round((container.memMB / 1024) * 100) : 0;

    const networkIO = React.useMemo(
        () => ({
            rx: "0.0",
            tx: "0.0",
        }),
        [selectedContainer]
    );

    function handleContainerChange(name: string) {
        setSelectedContainer(name);
        model.setMetricsContainer(name);
    }

    return (
        <div className="containers-widget__tab-content">
            <div className="containers-widget__stat-row">
                <div className="containers-widget__stat-card">
                    <div className="containers-widget__stat-label">Running</div>
                    <div className="containers-widget__stat-value containers-widget__stat-value--green">{running.length}</div>
                </div>
                <div className="containers-widget__stat-card">
                    <div className="containers-widget__stat-label">Stopped</div>
                    <div className="containers-widget__stat-value">{stopped.length}</div>
                </div>
                <div className="containers-widget__stat-card">
                    <div className="containers-widget__stat-label">Total Memory</div>
                    <div className="containers-widget__stat-value">{totalMem}MB</div>
                </div>
                <div className="containers-widget__stat-card">
                    <div className="containers-widget__stat-label">Total Containers</div>
                    <div className="containers-widget__stat-value">{containers.length}</div>
                </div>
            </div>

            <div className="containers-widget__toolbar">
                <select
                    className="containers-widget__select"
                    value={selectedContainer}
                    onChange={(e) => handleContainerChange(e.target.value)}
                >
                    {containers.map((c) => (
                        <option key={c.id} value={c.name}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </div>

            {container && (
                <>
                    <div className="containers-widget__section">
                        <div className="containers-widget__section-header">CPU Usage — {selectedContainer}</div>
                        <CpuSparkline points={cpuHistory} />
                        <div className="containers-widget__metric-row">
                            <span className="containers-widget__metric-label">Current</span>
                            <span className={`containers-widget__metric-val ${currentCpu > 30 ? "containers-widget__metric-val--warn" : "containers-widget__metric-val--ok"}`}>
                                {currentCpu.toFixed(1)}%
                            </span>
                        </div>
                    </div>

                    <div className="containers-widget__section">
                        <div className="containers-widget__section-header">Memory Usage</div>
                        <div className="containers-widget__mem-bar-wrap">
                            <div className="containers-widget__mem-bar-bg">
                                <div
                                    className="containers-widget__mem-bar-fill"
                                    style={{ width: `${Math.min(100, memPct)}%` }}
                                />
                            </div>
                            <span className="containers-widget__mem-label">{container.memMB}MB / 1024MB</span>
                        </div>
                    </div>

                    <div className="containers-widget__section">
                        <div className="containers-widget__section-header">Network I/O</div>
                        <div className="containers-widget__io-grid">
                            <div className="containers-widget__io-item">
                                <span className="containers-widget__io-label">RX</span>
                                <span className="containers-widget__io-val">{networkIO.rx} MB</span>
                            </div>
                            <div className="containers-widget__io-item">
                                <span className="containers-widget__io-label">TX</span>
                                <span className="containers-widget__io-val">{networkIO.tx} MB</span>
                            </div>
                            <div className="containers-widget__io-item">
                                <span className="containers-widget__io-label">Uptime</span>
                                <span className="containers-widget__io-val">{formatAge(container.created)}</span>
                            </div>
                            <div className="containers-widget__io-item">
                                <span className="containers-widget__io-label">Restarts</span>
                                <span className="containers-widget__io-val">0</span>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function ShellTab({ model }: { model: ContainerManagerViewModel }) {
    const containers = useAtomValue(model.containers);
    const [selectedContainer, setSelectedContainer] = useAtom(model.selectedShellContainer);
    const [command, setCommand] = useAtom(model.shellCommand);
    const shellOutput = useAtomValue(model.shellOutput);
    const shellHistory = useAtomValue(model.shellHistory);
    const outputEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (outputEndRef.current) {
            outputEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [shellOutput]);

    const QUICK_COMMANDS = ["bash", "sh", "ls /", "ps aux", "env", "cat /etc/os-release"];

    function handleRun() {
        model.runShellCommand(command);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") handleRun();
    }

    return (
        <div className="containers-widget__tab-content">
            <div className="containers-widget__toolbar">
                <select
                    className="containers-widget__select"
                    value={selectedContainer}
                    onChange={(e) => setSelectedContainer(e.target.value)}
                >
                    {containers.map((c) => (
                        <option key={c.id} value={c.name}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="containers-widget__quick-cmds">
                {QUICK_COMMANDS.map((cmd) => (
                    <button
                        key={cmd}
                        className="containers-widget__quick-btn"
                        onClick={() => model.runShellCommand(cmd)}
                    >
                        {cmd}
                    </button>
                ))}
            </div>

            <div className="containers-widget__shell-input-row">
                <span className="containers-widget__shell-prompt">$</span>
                <input
                    className="containers-widget__shell-input"
                    type="text"
                    placeholder="Enter command…"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button className="containers-widget__btn containers-widget__btn--primary" onClick={handleRun}>
                    Run
                </button>
            </div>

            <div className="containers-widget__shell-output">
                <pre>{shellOutput}</pre>
                <div ref={outputEndRef} />
            </div>

            {shellHistory.length > 0 && (
                <div className="containers-widget__section">
                    <div className="containers-widget__section-header">Command History</div>
                    <div className="containers-widget__history-list">
                        {shellHistory.map((entry, i) => (
                            <div
                                key={i}
                                className="containers-widget__history-item"
                                onClick={() => setCommand(entry.command)}
                                title="Click to re-use"
                            >
                                <span className="containers-widget__history-cmd">{entry.command}</span>
                                <span className="containers-widget__history-time">
                                    {new Date(entry.ts).toLocaleTimeString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export const ContainerManager: React.FC<ViewComponentProps<ContainerManagerViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    type TabId = "containers" | "logs" | "metrics" | "shell";
    const tabs: Array<{ id: TabId; label: string }> = [
        { id: "containers", label: "Containers" },
        { id: "logs", label: "Logs" },
        { id: "metrics", label: "Metrics" },
        { id: "shell", label: "Shell" },
    ];

    return (
        <div className="containers-widget">
            <div className="containers-widget__header-bar">
                <div className="containers-widget__title">
                    <span className="containers-widget__icon">🐳</span>
                    <span>Container Manager</span>
                    <span className="containers-widget__subtitle">Docker / K8s</span>
                </div>
            </div>
            <div className="containers-widget__tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`containers-widget__tab ${activeTab === tab.id ? "containers-widget__tab--active" : ""}`}
                        onClick={() => setActiveTab(tab.id as TabId)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="containers-widget__body">
                {activeTab === "containers" && <ContainersTab model={model} />}
                {activeTab === "logs" && <LogsTab model={model} />}
                {activeTab === "metrics" && <MetricsTab model={model} />}
                {activeTab === "shell" && <ShellTab model={model} />}
            </div>
        </div>
    );
};
