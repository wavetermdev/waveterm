// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { ProcessViewerBlockId } from "../mock/mockwaveenv";
import { useRpcOverride } from "../mock/use-rpc-override";

const PreviewNodeId = "preview-processviewer-node";

const MockProcesses: ProcessInfo[] = [
    { pid: 1, ppid: 0, command: "launchd", user: "root", cpu: 0.0, mem: 4096 * 1024, mempct: 0.01 },
    { pid: 123, ppid: 1, command: "kernel_task", user: "root", cpu: 12.3, mem: 2048 * 1024 * 1024, mempct: 6.25 },
    { pid: 456, ppid: 1, command: "WindowServer", user: "_windowserver", cpu: 5.1, mem: 512 * 1024 * 1024, mempct: 1.56 },
    { pid: 789, ppid: 1, command: "node", user: "mike", cpu: 8.7, mem: 256 * 1024 * 1024, mempct: 0.78 },
    { pid: 1001, ppid: 1, command: "Electron", user: "mike", cpu: 3.2, mem: 400 * 1024 * 1024, mempct: 1.22 },
    { pid: 1234, ppid: 1001, command: "waveterm-helper", user: "mike", cpu: 0.5, mem: 64 * 1024 * 1024, mempct: 0.20 },
    { pid: 2001, ppid: 1, command: "sshd", user: "root", cpu: 0.0, mem: 8 * 1024 * 1024, mempct: 0.02 },
    { pid: 2345, ppid: 1, command: "postgres", user: "postgres", cpu: 1.2, mem: 128 * 1024 * 1024, mempct: 0.39 },
    { pid: 3001, ppid: 1, command: "nginx", user: "_www", cpu: 0.3, mem: 32 * 1024 * 1024, mempct: 0.10 },
    { pid: 3456, ppid: 1, command: "python3", user: "mike", cpu: 2.8, mem: 96 * 1024 * 1024, mempct: 0.29 },
    { pid: 4001, ppid: 1, command: "docker", user: "root", cpu: 0.1, mem: 48 * 1024 * 1024, mempct: 0.15 },
    { pid: 4567, ppid: 4001, command: "containerd", user: "root", cpu: 0.2, mem: 80 * 1024 * 1024, mempct: 0.24 },
    { pid: 5001, ppid: 1, command: "zsh", user: "mike", cpu: 0.0, mem: 6 * 1024 * 1024, mempct: 0.02 },
    { pid: 5678, ppid: 5001, command: "vim", user: "mike", cpu: 0.0, mem: 20 * 1024 * 1024, mempct: 0.06 },
    { pid: 6001, ppid: 1, command: "coreaudiod", user: "_coreaudiod", cpu: 0.4, mem: 16 * 1024 * 1024, mempct: 0.05 },
];

const MockSummary: ProcessSummary = {
    total: MockProcesses.length,
    load1: 1.42,
    load5: 1.78,
    load15: 2.01,
    memtotal: 32 * 1024 * 1024 * 1024,
    memused: 18 * 1024 * 1024 * 1024,
    memfree: 2 * 1024 * 1024 * 1024,
};

function makeMockProcessListResponse(data: CommandRemoteProcessListData): ProcessListResponse {
    let procs = [...MockProcesses];

    const sortBy = (data.sortby as "pid" | "command" | "user" | "cpu" | "mem") ?? "cpu";
    const sortDesc = data.sortdesc ?? false;

    procs.sort((a, b) => {
        let cmp = 0;
        if (sortBy === "pid") cmp = a.pid - b.pid;
        else if (sortBy === "command") cmp = (a.command ?? "").localeCompare(b.command ?? "");
        else if (sortBy === "user") cmp = (a.user ?? "").localeCompare(b.user ?? "");
        else if (sortBy === "cpu") cmp = (a.cpu ?? 0) - (b.cpu ?? 0);
        else if (sortBy === "mem") cmp = (a.mem ?? 0) - (b.mem ?? 0);
        return sortDesc ? -cmp : cmp;
    });

    const start = data.start ?? 0;
    const limit = data.limit ?? procs.length;
    const sliced = procs.slice(start, start + limit);

    return {
        processes: sliced,
        summary: MockSummary,
        ts: Date.now(),
        hascpu: true,
        totalcount: procs.length,
        filteredcount: procs.length,
    };
}

export default function ProcessViewerPreview() {
    const nodeModel = React.useMemo(
        () =>
            makeMockNodeModel({
                nodeId: PreviewNodeId,
                blockId: ProcessViewerBlockId,
                innerRect: { width: "800px", height: "500px" },
                numLeafs: 1,
            }),
        []
    );

    useRpcOverride("RemoteProcessListCommand", async (_client, data) => {
        return makeMockProcessListResponse(data);
    });

    return (
        <div className="flex w-full max-w-[860px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">processviewer block (mock RPC — RemoteProcessListCommand)</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[540px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
