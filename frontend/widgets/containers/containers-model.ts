// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { ContainerManager } from "./containers";

export type ContainerStatus = "running" | "stopped" | "error";

export type Container = {
    id: string;
    name: string;
    image: string;
    status: ContainerStatus;
    cpu: number;
    memMB: number;
    ports: string;
    created: number;
};

export type LogLine = {
    ts: number;
    level: "INFO" | "WARN" | "ERROR";
    message: string;
};

export type CpuPoint = {
    ts: number;
    value: number;
};

export type ShellHistoryEntry = {
    command: string;
    output: string;
    ts: number;
};

export type DockerApiContainer = {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
    Ports: Array<{ IP?: string; PrivatePort: number; PublicPort?: number; Type: string }>;
    Created: number;
};

function generateCpuHistory(baseCpu: number, count: number): CpuPoint[] {
    const now = Date.now();
    const points: CpuPoint[] = [];
    // Use a fixed sawtooth pattern rather than random walk
    for (let i = count; i >= 0; i--) {
        const phase = (count - i) % 20;
        const val = Math.max(0, Math.min(100, baseCpu + (phase < 10 ? phase * 0.4 : (20 - phase) * 0.4)));
        points.push({ ts: now - i * 3000, value: val });
    }
    return points;
}

export class ContainerManagerViewModel implements ViewModel {
    viewType = "containers";
    blockId: string;

    viewIcon = jotai.atom<string>("cube");
    viewName = jotai.atom<string>("Container Manager");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"containers" | "logs" | "metrics" | "shell">("containers");
    containers = jotai.atom<Container[]>([]);
    searchFilter = jotai.atom<string>("");
    statusFilter = jotai.atom<"all" | ContainerStatus>("all");

    selectedLogContainer = jotai.atom<string>("");
    logLines = jotai.atom<LogLine[]>([]);
    followLogs = jotai.atom<boolean>(true);

    selectedMetricsContainer = jotai.atom<string>("");
    cpuHistory = jotai.atom<CpuPoint[]>([]);

    selectedShellContainer = jotai.atom<string>("");
    shellCommand = jotai.atom<string>("");
    shellOutput = jotai.atom<string>("Connect to Docker to run shell commands.\n");
    shellHistory = jotai.atom<ShellHistoryEntry[]>([]);

    dockerAvailable = jotai.atom<boolean>(false);
    dataSource = jotai.atom<"live" | "demo">("demo");

    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const containers = get(this.containers);
            const running = containers.filter((c) => c.status === "running").length;
            const total = containers.length;
            const src = get(this.dataSource);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `${running}/${total} running`,
                    className: "widget-containers-status",
                    noGrow: true,
                },
                {
                    elemtype: "text",
                    text: src === "live" ? "● LIVE" : "○ DEMO",
                    className: src === "live" ? "widget-containers-live" : "widget-containers-demo",
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh",
                    click: () => this.refreshContainers(),
                },
            ];
            return elems;
        });
        void this.initDockerData();
    }

    get viewComponent(): ViewComponent {
        return ContainerManager as ViewComponent;
    }

    async initDockerData() {
        // Requires Docker daemon to expose its API on TCP (--api-cors-header / -H tcp://localhost:2375).
        // This is disabled by default; only enable in controlled/local dev environments.
        // Falls back to demo mock data when Docker is not accessible via TCP.
        try {
            const res = await fetch("http://localhost:2375/v1.43/containers/json?all=true", {
                signal: AbortSignal.timeout(2000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as DockerApiContainer[];
            const containers = data.map(mapDockerContainer);
            globalStore.set(this.containers, containers);
            globalStore.set(this.dockerAvailable, true);
            globalStore.set(this.dataSource, "live");
            // Use first container for initial log/metrics view if available
            if (containers.length > 0) {
                globalStore.set(this.selectedLogContainer, containers[0].name);
                globalStore.set(this.selectedMetricsContainer, containers[0].name);
                void this.fetchContainerLogs(containers[0].id, containers[0].name);
            }
        } catch {
            // Docker not accessible via TCP — fall back to mock data
            globalStore.set(this.dockerAvailable, false);
            globalStore.set(this.dataSource, "demo");
        }
        this.startRefresh();
    }

    async refreshContainers() {
        const isLive = globalStore.get(this.dockerAvailable);
        if (isLive) {
            try {
                const res = await fetch("http://localhost:2375/v1.43/containers/json?all=true", {
                    signal: AbortSignal.timeout(3000),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as DockerApiContainer[];
                globalStore.set(this.containers, data.map(mapDockerContainer));
                return;
            } catch {
                // Docker became unavailable — fall back to mock drift
                globalStore.set(this.dockerAvailable, false);
                globalStore.set(this.dataSource, "demo");
            }
        }
        // Mock drift for demo mode — stable values, no random
        const prev = globalStore.get(this.containers);
        globalStore.set(
            this.containers,
            prev.map((c) => ({
                ...c,
                cpu: c.status === "running" ? c.cpu : 0,
            }))
        );(containerId: string, containerName: string) {
        const isLive = globalStore.get(this.dockerAvailable);
        if (isLive) {
            try {
                const res = await fetch(
                    `http://localhost:2375/v1.43/containers/${containerId}/logs?stdout=1&stderr=1&tail=100&timestamps=1`,
                    { signal: AbortSignal.timeout(5000) }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const raw = await res.text();
                // Docker log stream uses a multiplexed framing format:
                // each frame has an 8-byte header (stream type + 3 padding + 4-byte length).
                // We strip the header bytes and keep the text payload.
                const lines = raw
                    .split("\n")
                    .map((l) => (l.length > 8 ? l.slice(8) : l).replace(/\r/g, "").trim())
                    .filter(Boolean);
                const logLines: LogLine[] = lines.map((msg) => ({
                    ts: Date.now(),
                    level: /error/i.test(msg) ? "ERROR" : /warn/i.test(msg) ? "WARN" : "INFO",
                    message: msg,
                }));
                globalStore.set(this.logLines, logLines);
                return;
            } catch {
                // Fall through to mock logs
            }
        }
        globalStore.set(this.logLines, []);
    }

    setLogContainer(name: string) {
        const containers = globalStore.get(this.containers);
        const container = containers.find((c) => c.name === name);
        globalStore.set(this.selectedLogContainer, name);
        if (container) {
            void this.fetchContainerLogs(container.id, name);
        } else {
            globalStore.set(this.logLines, []);
        }
    }

    setMetricsContainer(name: string) {
        const containers = globalStore.get(this.containers);
        const c = containers.find((x) => x.name === name);
        globalStore.set(this.selectedMetricsContainer, name);
        globalStore.set(this.cpuHistory, generateCpuHistory(c?.cpu ?? 0, 30));
    }

    runShellCommand(command: string) {
        if (!command.trim()) return;
        const result = "[Shell execution requires Docker — docker exec not connected]";
        const containerName = globalStore.get(this.selectedShellContainer);
        const prev = globalStore.get(this.shellOutput);
        const newOutput = prev + `\n[${containerName}] $ ${command}\n${result}\n`;
        globalStore.set(this.shellOutput, newOutput);
        const prevHistory = globalStore.get(this.shellHistory);
        globalStore.set(this.shellHistory, [
            { command, output: result, ts: Date.now() },
            ...prevHistory.slice(0, 19),
        ]);
        globalStore.set(this.shellCommand, "");
    }

    toggleContainerStatus(id: string) {
        const prev = globalStore.get(this.containers);
        globalStore.set(
            this.containers,
            prev.map((c) => {
                if (c.id !== id) return c;
                if (c.status === "running") return { ...c, status: "stopped" as ContainerStatus, cpu: 0, memMB: 0 };
                return { ...c, status: "running" as ContainerStatus };
            })
        );
    }

    restartContainer(id: string) {
        const prev = globalStore.get(this.containers);
        globalStore.set(
            this.containers,
            prev.map((c) => {
                if (c.id !== id) return c;
                return { ...c, status: "running" as ContainerStatus };
            })
        );
    }

    removeContainer(id: string) {
        const prev = globalStore.get(this.containers);
        globalStore.set(
            this.containers,
            prev.filter((c) => c.id !== id)
        );
    }

    clearLogs() {
        globalStore.set(this.logLines, []);
    }

    startRefresh() {
        this.refreshInterval = setInterval(async () => {
            const isLive = globalStore.get(this.dockerAvailable);

            if (isLive) {
                // Attempt live container list refresh for status/CPU updates
                try {
                    const res = await fetch("http://localhost:2375/v1.43/containers/json?all=true", {
                        signal: AbortSignal.timeout(2000),
                    });
                    if (res.ok) {
                        const data = (await res.json()) as DockerApiContainer[];
                        const updated = data.map(mapDockerContainer);
                        // Preserve existing CPU readings (real CPU requires streaming stats)
                        const prev = globalStore.get(this.containers);
                        globalStore.set(
                            this.containers,
                            updated.map((c) => {
                                const existing = prev.find((p) => p.id === c.id);
                                return existing ? { ...c, cpu: existing.cpu } : c;
                            })
                        );
                    }
                } catch {
                    // Ignore transient errors
                }
            } else {
                // Mock CPU drift for demo mode — stable, no random
                const prev = globalStore.get(this.containers);
                globalStore.set(
                    this.containers,
                    prev.map((c) => {
                        if (c.status !== "running") return c;
                        return c;
                    })
                );
            }

            // Append new cpu history point for metrics tab (use current container cpu — no random walk)
            const selected = globalStore.get(this.selectedMetricsContainer);
            const containers = globalStore.get(this.containers);
            const selectedContainer = containers.find((c) => c.name === selected);
            if (selectedContainer) {
                const prevHistory = globalStore.get(this.cpuHistory);
                globalStore.set(this.cpuHistory, [...prevHistory.slice(1), { ts: Date.now(), value: selectedContainer.cpu }]);
            }

            // Append a new log line if following (demo mode only — live mode gets real logs)
            const follow = globalStore.get(this.followLogs);
            if (follow && !isLive) {
                const logContainer = globalStore.get(this.selectedLogContainer);
                const runningContainers = globalStore.get(this.containers);
                const isRunning = runningContainers.find((c) => c.name === logContainer)?.status === "running";
                if (isRunning) {
                    const DEMO_LOG_CYCLE: Array<{ level: "INFO" | "WARN" | "ERROR"; message: string }> = [
                        { level: "INFO",  message: "heartbeat OK" },
                        { level: "INFO",  message: "processed 1 request" },
                        { level: "INFO",  message: "cache hit" },
                        { level: "INFO",  message: "connection pool: 3/10 active" },
                        { level: "WARN",  message: "GC pause: 2ms" },
                        { level: "INFO",  message: "metrics exported" },
                        { level: "INFO",  message: "health check passed" },
                    ];
                    const prevLogs = globalStore.get(this.logLines);
                    const entry = DEMO_LOG_CYCLE[prevLogs.length % DEMO_LOG_CYCLE.length];
                    globalStore.set(this.logLines, [...prevLogs, { ts: Date.now(), level: entry.level, message: entry.message }]);
                }
            }
        }, 2500);
    }

    dispose() {
        if (this.refreshInterval != null) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    giveFocus(): boolean {
        return true;
    }
}
