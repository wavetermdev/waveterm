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

const INITIAL_CONTAINERS: Container[] = [
    {
        id: "c1",
        name: "wave-postgres",
        image: "postgres:16-alpine",
        status: "running",
        cpu: 2.1,
        memMB: 128,
        ports: "5432:5432",
        created: Date.now() - 3 * 24 * 60 * 60 * 1000,
    },
    {
        id: "c2",
        name: "wave-redis",
        image: "redis:7.2-alpine",
        status: "running",
        cpu: 0.4,
        memMB: 32,
        ports: "6379:6379",
        created: Date.now() - 3 * 24 * 60 * 60 * 1000,
    },
    {
        id: "c3",
        name: "ml-worker",
        image: "python:3.11-slim",
        status: "running",
        cpu: 45.2,
        memMB: 512,
        ports: "",
        created: Date.now() - 1 * 24 * 60 * 60 * 1000,
    },
    {
        id: "c4",
        name: "finstream-api",
        image: "node:20-alpine",
        status: "running",
        cpu: 3.8,
        memMB: 96,
        ports: "3001:3001",
        created: Date.now() - 2 * 24 * 60 * 60 * 1000,
    },
    {
        id: "c5",
        name: "nginx-proxy",
        image: "nginx:1.25-alpine",
        status: "running",
        cpu: 0.2,
        memMB: 24,
        ports: "80:80, 443:443",
        created: Date.now() - 7 * 24 * 60 * 60 * 1000,
    },
    {
        id: "c6",
        name: "backup-cron",
        image: "alpine:3.19",
        status: "stopped",
        cpu: 0,
        memMB: 0,
        ports: "",
        created: Date.now() - 5 * 24 * 60 * 60 * 1000,
    },
];

function generateMockLogs(containerName: string): LogLine[] {
    const levels: Array<"INFO" | "WARN" | "ERROR"> = ["INFO", "INFO", "INFO", "WARN", "INFO", "ERROR", "INFO", "INFO"];
    const messages: Record<string, string[]> = {
        "wave-postgres": [
            "database system is ready to accept connections",
            "autovacuum launcher started",
            "checkpoint starting: time",
            "checkpoint complete: wrote 42 buffers",
            "connection received: host=172.18.0.3 port=54321",
            'ERROR:  relation "missing_table" does not exist',
            "statement: SELECT * FROM pg_stat_activity",
            "connection authorized: user=wave database=wave",
            "LOG:  checkpoint complete: wrote 18 buffers (0.1%)",
            "LOG:  autovacuum: processing database \"wave\"",
            "LOG:  database system is ready to accept connections",
            "LOG:  received fast shutdown request",
            "LOG:  aborting any active transactions",
            "WARN:  transaction ID wrap around in 1 billion transactions",
            "LOG:  pg_hba.conf was not changed",
            "LOG:  database system was shut down at 2026-01-15 08:22:01 UTC",
            "LOG:  entering standby mode",
            "LOG:  redo starts at 0/180",
            "INFO:  starting point-in-time recovery",
            "LOG:  consistent recovery state reached",
            "LOG:  database system is ready to accept read only connections",
            "WARN:  WAL file is from different database system",
        ],
        "wave-redis": [
            "Server initialized",
            "Ready to accept connections",
            "DB 0: 142 keys, 0 expires; LRU clock: 12345678",
            "MASTER <-> REPLICA sync started",
            "Background saving started by child 42",
            "Background saving terminated with success",
            "WARN CONFIG REWRITE executed with success",
            "Accepted 172.18.0.1:45678",
            "Client closed connection",
            "INFO: Saving the final RDB snapshot before exiting",
            "Removing the pid file",
            "WARN  There was a problem connecting to the server",
            "INFO: 10 changes in 300 seconds. Saving...",
            "Background saving started",
            "DB saved on disk",
            "RDB: 0 MB of memory used by copy-on-write",
            "Background saving terminated with success",
            "Asynchronous AOF fsync is taking too long (disk is busy?)",
            "INFO: 1 changes in 3600 seconds. Saving...",
            "ERROR: MISCONF Redis is configured to save RDB snapshots",
            "INFO: Connection from 172.18.0.3",
            "INFO: Accepted 172.18.0.3:45682",
        ],
        "ml-worker": [
            "Starting ML worker process pid=1",
            "Loading model checkpoint from /models/v3.pkl",
            "Model loaded: gradient_boost_signal_v2 (1.2s)",
            "Waiting for jobs on queue: ml-jobs",
            "WARN: GPU not available, falling back to CPU",
            "Job received: inference_request id=e3f1a2b4",
            "Running inference on batch_size=32",
            "Inference complete in 142ms",
            "Sending result to output queue",
            "Job received: training_update id=8c7d5e6f",
            "WARN: Memory usage at 87% of limit",
            "ERROR: OOM killed subprocess, restarting",
            "Subprocess restarted successfully",
            "INFO: Throughput: 12.4 inferences/sec",
            "INFO: Model accuracy: 71.2%",
            "INFO: Running batch validation",
            "INFO: Validation loss: 0.0432",
            "INFO: Saving checkpoint to /models/v3_checkpoint.pkl",
            "WARN: Checkpoint save took 3.2s (high I/O load)",
            "INFO: Feature extraction complete",
            "INFO: Processed 10000 samples",
            "INFO: Worker heartbeat OK",
        ],
        "finstream-api": [
            "Server starting on port 3001",
            "Connected to PostgreSQL",
            "Connected to Redis",
            "GET /health 200 1ms",
            "POST /api/v1/signals 200 45ms",
            "GET /api/v1/positions 200 12ms",
            "WARN: Rate limit approaching for client 192.168.1.42",
            "GET /api/v1/metrics 200 8ms",
            "ERROR: WebSocket connection closed unexpectedly",
            "WebSocket client reconnected",
            "POST /api/v1/orders 201 89ms",
            "GET /api/v1/history?limit=100 200 234ms",
            "INFO: Cache hit ratio: 94.2%",
            "WARN: Slow query detected (>500ms): SELECT * FROM signals",
            "GET /api/v1/stream 101 2ms (WebSocket upgrade)",
            "INFO: Active WebSocket connections: 7",
            "INFO: Total requests today: 14,823",
            "INFO: P99 latency: 112ms",
            "GET /api/v1/config 200 3ms",
            "DELETE /api/v1/sessions/old 204 22ms",
            "POST /api/v1/auth/refresh 200 31ms",
            "INFO: JWT rotated successfully",
        ],
        "nginx-proxy": [
            '172.18.0.1 - - [GET /] 200 612 "-" "Mozilla/5.0"',
            '172.18.0.1 - - [GET /api/v1/health] 200 18 "-" "curl/7.88"',
            '10.0.0.5 - - [POST /api/v1/signals] 200 1024 "-" "python-httpx/0.26"',
            "WARN: upstream response time 1.243s",
            '172.18.0.1 - - [GET /static/app.js] 304 0 "-" "Mozilla/5.0"',
            'ERROR: connect() failed (111: Connection refused) upstream "http://finstream-api:3001"',
            "Upstream recovered, retrying",
            '172.18.0.2 - - [GET /metrics] 200 2048 "-" "prometheus/2.49"',
            "SSL certificate expires in 30 days",
            '172.18.0.1 - - [GET /favicon.ico] 404 153 "-" "Mozilla/5.0"',
            'WARN: too many open files (1024/1024)',
            '10.0.0.1 - - [DELETE /api/v1/sessions] 204 0 "-" "axios/1.6"',
            '172.18.0.1 - - [GET /api/v1/stream] 101 0 "-" "Mozilla/5.0" (ws)',
            "INFO: reloading nginx config",
            "INFO: nginx config reload OK",
            '172.18.0.3 - - [GET /api/v1/positions] 200 768 "-" "curl/7.88"',
            '172.18.0.1 - - [POST /api/v1/orders] 201 312 "-" "axios/1.6"',
            'WARN: client 172.18.0.99 rate limit exceeded',
            '172.18.0.1 - - [GET /] 200 612 "-" "Mozilla/5.0"',
            '10.0.0.5 - - [GET /api/v1/metrics] 200 4096 "-" "prometheus/2.49"',
            "INFO: keepalive connections: 12",
            "INFO: worker processes: 4",
        ],
        "backup-cron": [
            "INFO: backup-cron container stopped",
            "INFO: last run completed at 2026-01-15 03:00:00 UTC",
            "INFO: next scheduled run: 2026-01-16 03:00:00 UTC",
            "INFO: last backup size: 2.4 GB",
            "INFO: backup stored at s3://wave-backups/2026-01-15/",
        ],
    };
    const msgList = messages[containerName] ?? messages["finstream-api"];
    return msgList.map((msg, i) => {
        const levelIdx = i % levels.length;
        let level: "INFO" | "WARN" | "ERROR" = "INFO";
        if (msg.startsWith("WARN")) level = "WARN";
        else if (msg.startsWith("ERROR")) level = "ERROR";
        else level = levels[levelIdx];
        return {
            ts: Date.now() - (msgList.length - i) * 4500,
            level,
            message: msg,
        };
    });
}

function generateCpuHistory(baseCpu: number, count: number): CpuPoint[] {
    const now = Date.now();
    const points: CpuPoint[] = [];
    let val = baseCpu;
    for (let i = count; i >= 0; i--) {
        val = Math.max(0, Math.min(100, val + (Math.random() - 0.5) * 4));
        points.push({ ts: now - i * 3000, value: val });
    }
    return points;
}

const MOCK_SHELL_RESULTS: Record<string, string> = {
    bash: "bash-5.2# ",
    sh: "/ # ",
    "ls /": "bin   dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var",
    "ps aux": `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1   4180  3344 ?        Ss   08:00   0:00 /bin/sh
root        42  0.0  0.0   2292  1280 ?        S    08:00   0:00 sleep 3600
root        99  0.1  0.1   6552  4096 pts/0    Ss   08:12   0:00 bash
root       100  0.0  0.0   2788  1024 pts/0    R+   08:12   0:00 ps aux`,
    env: `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOSTNAME=wave-container
HOME=/root
TERM=xterm
LANG=C.UTF-8
TZ=UTC`,
    "cat /etc/os-release": `NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.19.0
PRETTY_NAME="Alpine Linux v3.19"
HOME_URL="https://alpinelinux.org/"
BUG_REPORT_URL="https://gitlab.alpinelinux.org/alpine/aports/-/issues"`,
};

export class ContainerManagerViewModel implements ViewModel {
    viewType = "containers";
    blockId: string;

    viewIcon = jotai.atom<string>("cube");
    viewName = jotai.atom<string>("Container Manager");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"containers" | "logs" | "metrics" | "shell">("containers");
    containers = jotai.atom<Container[]>(INITIAL_CONTAINERS);
    searchFilter = jotai.atom<string>("");
    statusFilter = jotai.atom<"all" | ContainerStatus>("all");

    selectedLogContainer = jotai.atom<string>("wave-postgres");
    logLines = jotai.atom<LogLine[]>(generateMockLogs("wave-postgres"));
    followLogs = jotai.atom<boolean>(true);

    selectedMetricsContainer = jotai.atom<string>("wave-postgres");
    cpuHistory = jotai.atom<CpuPoint[]>(generateCpuHistory(2.1, 30));

    selectedShellContainer = jotai.atom<string>("wave-postgres");
    shellCommand = jotai.atom<string>("");
    shellOutput = jotai.atom<string>('Type a command and press Run, or click a quick command below.\n\nConnected to: wave-postgres\nType "help" for more information.\n');
    shellHistory = jotai.atom<ShellHistoryEntry[]>([]);

    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const containers = get(this.containers);
            const running = containers.filter((c) => c.status === "running").length;
            const total = containers.length;
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `${running}/${total} running`,
                    className: "widget-containers-status",
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
        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return ContainerManager as ViewComponent;
    }

    refreshContainers() {
        const prev = globalStore.get(this.containers);
        globalStore.set(
            this.containers,
            prev.map((c) => ({
                ...c,
                cpu: c.status === "running" ? Math.max(0, Math.min(100, c.cpu + (Math.random() - 0.5) * 3)) : 0,
            }))
        );
    }

    setLogContainer(name: string) {
        globalStore.set(this.selectedLogContainer, name);
        globalStore.set(this.logLines, generateMockLogs(name));
    }

    setMetricsContainer(name: string) {
        const containers = globalStore.get(this.containers);
        const c = containers.find((x) => x.name === name);
        globalStore.set(this.selectedMetricsContainer, name);
        globalStore.set(this.cpuHistory, generateCpuHistory(c?.cpu ?? 5, 30));
    }

    runShellCommand(command: string) {
        if (!command.trim()) return;
        const result = MOCK_SHELL_RESULTS[command.trim()] ?? `sh: ${command}: command not found`;
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
        this.refreshInterval = setInterval(() => {
            // Drift CPU values for running containers
            const prev = globalStore.get(this.containers);
            globalStore.set(
                this.containers,
                prev.map((c) => {
                    if (c.status !== "running") return c;
                    const drift = (Math.random() - 0.5) * 2.5;
                    return { ...c, cpu: Math.max(0, Math.min(100, c.cpu + drift)) };
                })
            );
            // Append new cpu history point for metrics tab
            const selected = globalStore.get(this.selectedMetricsContainer);
            const containers = globalStore.get(this.containers);
            const selectedContainer = containers.find((c) => c.name === selected);
            if (selectedContainer) {
                const prevHistory = globalStore.get(this.cpuHistory);
                const lastVal = prevHistory[prevHistory.length - 1]?.value ?? selectedContainer.cpu;
                const newVal = Math.max(0, Math.min(100, lastVal + (Math.random() - 0.5) * 3));
                globalStore.set(this.cpuHistory, [...prevHistory.slice(1), { ts: Date.now(), value: newVal }]);
            }
            // Append a new log line if following
            const follow = globalStore.get(this.followLogs);
            if (follow) {
                const logContainer = globalStore.get(this.selectedLogContainer);
                const runningContainers = globalStore.get(this.containers);
                const isRunning = runningContainers.find((c) => c.name === logContainer)?.status === "running";
                if (isRunning) {
                    const levels: Array<"INFO" | "WARN" | "ERROR"> = ["INFO", "INFO", "INFO", "WARN"];
                    const level = levels[Math.floor(Math.random() * levels.length)];
                    const liveMsgs = [
                        "heartbeat OK",
                        "processed 1 request",
                        "cache hit",
                        "connection pool: 3/10 active",
                        "GC pause: 2ms",
                        "metrics exported",
                        "health check passed",
                    ];
                    const msg = liveMsgs[Math.floor(Math.random() * liveMsgs.length)];
                    const prevLogs = globalStore.get(this.logLines);
                    globalStore.set(this.logLines, [...prevLogs, { ts: Date.now(), level, message: msg }]);
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
