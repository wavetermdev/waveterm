// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { RpcApi } from "@/app/store/wshclientapi";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { Atom, atom, useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useState } from "react";

type MCPTool = {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, any>;
};

type MCPServerInfo = {
    name: string;
    version: string;
};

type MCPStatusResponse = {
    connected: boolean;
    serverName?: string;
    serverInfo?: MCPServerInfo;
    tools?: MCPTool[];
    error?: string;
};

type MCPCallLogEntry = {
    timestamp: string;
    toolName: string;
    duration: number;
    error?: string;
    resultLen: number;
    arguments?: Record<string, any>;
    result?: string;
};

type MCPCallResponse = {
    result?: string;
    error?: string;
    duration?: number;
};

function mcpUrl(path: string): string {
    return getWebServerEndpoint() + path;
}

async function fetchMCPStatus(cwd: string): Promise<MCPStatusResponse> {
    const resp = await fetch(mcpUrl(`/wave/mcp/status?cwd=${encodeURIComponent(cwd)}`));
    return resp.json();
}

async function callMCPTool(cwd: string, toolName: string, args?: Record<string, any>): Promise<MCPCallResponse> {
    const resp = await fetch(mcpUrl("/wave/mcp/call"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, toolName, arguments: args || {} }),
    });
    return resp.json();
}

async function fetchCallLog(): Promise<MCPCallLogEntry[]> {
    const resp = await fetch(mcpUrl("/wave/mcp/calllog"));
    return resp.json();
}

// ── Tool Run Dialog ──────────────────────────────────────────────

const ToolRunDialog = memo(
    ({
        tool,
        cwd,
        onClose,
    }: {
        tool: MCPTool;
        cwd: string;
        onClose: () => void;
    }) => {
        const [argsText, setArgsText] = useState("{}");
        const [result, setResult] = useState<MCPCallResponse | null>(null);
        const [running, setRunning] = useState(false);

        const handleRun = useCallback(async () => {
            setRunning(true);
            setResult(null);
            try {
                const args = JSON.parse(argsText);
                const resp = await callMCPTool(cwd, tool.name, args);
                setResult(resp);
            } catch (e: any) {
                setResult({ error: e.message });
            }
            setRunning(false);
        }, [cwd, tool.name, argsText]);

        return (
            <div className="border border-gray-600 rounded-lg p-4 mb-4 bg-gray-800/50">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-white font-semibold text-sm">{tool.name}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xs cursor-pointer">
                        Close
                    </button>
                </div>
                <p className="text-gray-400 text-xs mb-3">{tool.description}</p>

                <div className="mb-3">
                    <label className="text-gray-300 text-xs block mb-1">Arguments (JSON)</label>
                    <textarea
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        className="w-full bg-gray-900 text-gray-200 text-xs font-mono p-2 rounded border border-gray-600 focus:border-accent-500 focus:outline-none resize-y"
                        rows={3}
                        spellCheck={false}
                    />
                </div>

                <button
                    onClick={handleRun}
                    disabled={running}
                    className="bg-accent-600 hover:bg-accent-500 disabled:bg-gray-600 text-white text-xs px-3 py-1.5 rounded cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                    {running ? "Running..." : "Run"}
                </button>

                {result && (
                    <div className="mt-3">
                        {result.error ? (
                            <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-300 text-xs">
                                Error: {result.error}
                            </div>
                        ) : (
                            <div className="bg-gray-900 border border-gray-600 rounded p-2">
                                <div className="text-gray-400 text-xs mb-1">
                                    Result ({result.duration?.toFixed(2)}s)
                                </div>
                                <pre className="text-gray-200 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                                    {result.result}
                                </pre>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
);
ToolRunDialog.displayName = "ToolRunDialog";

// ── Call Log Item (expandable) ────────────────────────────────────

const CallLogItem = memo(({ entry }: { entry: MCPCallLogEntry }) => {
    const [expanded, setExpanded] = useState(false);
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const hasDetails = entry.result || entry.error || entry.arguments;

    return (
        <div className="rounded hover:bg-gray-700/30 transition-colors">
            <div
                className={`flex items-center gap-2 text-xs py-1.5 px-2 ${hasDetails ? "cursor-pointer" : ""}`}
                onClick={() => hasDetails && setExpanded(!expanded)}
            >
                {hasDetails && (
                    <i className={`fa fa-chevron-${expanded ? "down" : "right"} text-gray-500 w-3 flex-shrink-0`} />
                )}
                {!hasDetails && <span className="w-3 flex-shrink-0" />}
                <span className="text-gray-500 w-16 flex-shrink-0">{time}</span>
                <span className="text-white font-mono flex-1 truncate">{entry.toolName}</span>
                <span className="text-gray-400 flex-shrink-0">{entry.duration.toFixed(2)}s</span>
                {entry.error ? (
                    <span className="text-red-400 flex-shrink-0">
                        <i className="fa fa-exclamation-circle" />
                    </span>
                ) : (
                    <span className="text-green-400 flex-shrink-0">
                        <i className="fa fa-check" />
                    </span>
                )}
            </div>
            {expanded && hasDetails && (
                <div className="px-2 pb-2 ml-5">
                    {entry.arguments && Object.keys(entry.arguments).length > 0 && (
                        <div className="mb-2">
                            <div className="text-gray-400 text-xs mb-0.5">Arguments:</div>
                            <pre className="text-gray-300 text-xs font-mono bg-gray-900 rounded p-1.5 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                {JSON.stringify(entry.arguments, null, 2)}
                            </pre>
                        </div>
                    )}
                    {entry.error && (
                        <div className="mb-2">
                            <div className="text-gray-400 text-xs mb-0.5">Error:</div>
                            <pre className="text-red-300 text-xs font-mono bg-red-900/20 rounded p-1.5 whitespace-pre-wrap">
                                {entry.error}
                            </pre>
                        </div>
                    )}
                    {entry.result && (
                        <div>
                            <div className="text-gray-400 text-xs mb-0.5">
                                Result ({entry.resultLen.toLocaleString()} bytes):
                            </div>
                            <pre className="text-gray-300 text-xs font-mono bg-gray-900 rounded p-1.5 whitespace-pre-wrap max-h-64 overflow-y-auto">
                                {entry.result}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
CallLogItem.displayName = "CallLogItem";

// ── CWD Input (shown when no CWD is set) ─────────────────────────

function MCPCwdInput({ model }: { model: MCPClientViewModel }) {
    const [inputCwd, setInputCwd] = useState("");

    const handleConnect = useCallback(() => {
        if (!inputCwd.trim()) return;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", model.blockId),
            meta: { "cmd:cwd": inputCwd.trim() },
        });
    }, [inputCwd, model.blockId]);

    return (
        <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
            <i className="fa fa-plug text-gray-500 text-3xl" />
            <p className="text-gray-400 text-sm text-center">
                Enter path to a directory with <span className="text-white font-mono">.mcp.json</span>
            </p>
            <div className="flex gap-2 w-full max-w-md">
                <input
                    type="text"
                    value={inputCwd}
                    onChange={(e) => setInputCwd(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                    placeholder="/path/to/project"
                    className="flex-1 bg-gray-900 text-gray-200 text-sm font-mono px-3 py-2 rounded border border-gray-600 focus:border-accent-500 focus:outline-none"
                    spellCheck={false}
                />
                <button
                    onClick={handleConnect}
                    disabled={!inputCwd.trim()}
                    className="bg-accent-600 hover:bg-accent-500 disabled:bg-gray-600 text-white text-sm px-4 py-2 rounded cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                    Connect
                </button>
            </div>
        </div>
    );
}

// ── Main MCP Client View ─────────────────────────────────────────

function MCPClientView({ model }: ViewComponentProps<MCPClientViewModel>) {
    const [status, setStatus] = useState<MCPStatusResponse | null>(null);
    const [callLogEntries, setCallLogEntries] = useState<MCPCallLogEntry[]>([]);
    const [activeTool, setActiveTool] = useState<MCPTool | null>(null);
    const [loading, setLoading] = useState(true);
    const cwd = useAtomValue(model.cwdAtom);

    const refresh = useCallback(async () => {
        if (!cwd) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [statusResp, logResp] = await Promise.all([fetchMCPStatus(cwd), fetchCallLog()]);
            setStatus(statusResp);
            setCallLogEntries(logResp || []);
        } catch {
            setStatus({ connected: false, error: "Failed to fetch status" });
        }
        setLoading(false);
    }, [cwd]);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 10000);
        return () => clearInterval(interval);
    }, [refresh]);

    if (!cwd) {
        return <MCPCwdInput model={model} />;
    }

    if (loading && !status) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Connecting to MCP server...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden text-sm">
            {/* Server Status Header */}
            <div className="p-3 border-b border-gray-600 flex-shrink-0">
                <div className="flex items-center gap-2 mb-1">
                    <span
                        className={`inline-block w-2 h-2 rounded-full ${
                            status?.connected ? "bg-green-400" : "bg-red-400"
                        }`}
                    />
                    <span className="text-white font-semibold text-sm">
                        {status?.serverInfo
                            ? `${status.serverInfo.name} v${status.serverInfo.version}`
                            : status?.serverName || "MCP Server"}
                    </span>
                    <button
                        onClick={refresh}
                        className="ml-auto text-gray-400 hover:text-white text-xs cursor-pointer transition-colors"
                        title="Refresh"
                    >
                        <i className="fa fa-refresh" />
                    </button>
                </div>
                <div className="text-gray-400 text-xs">
                    {status?.connected ? "Connected" : status?.error || "Disconnected"}
                    {" · "}
                    CWD: <span className="text-gray-300">{cwd}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {/* Active Tool Dialog */}
                {activeTool && (
                    <ToolRunDialog tool={activeTool} cwd={cwd} onClose={() => setActiveTool(null)} />
                )}

                {/* Tools List */}
                {status?.tools && status.tools.length > 0 && (
                    <div className="mb-4">
                        <h3 className="text-gray-300 text-xs font-semibold uppercase tracking-wide mb-2">
                            Tools ({status.tools.length})
                        </h3>
                        <div className="space-y-1">
                            {status.tools.map((tool) => (
                                <div
                                    key={tool.name}
                                    className="flex items-center justify-between p-2 rounded hover:bg-gray-700/50 transition-colors group"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white text-xs font-mono truncate">
                                            {tool.name}
                                        </div>
                                        <div className="text-gray-400 text-xs truncate">
                                            {tool.description?.slice(0, 80)}
                                            {(tool.description?.length ?? 0) > 80 ? "..." : ""}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setActiveTool(tool)}
                                        className="text-accent-400 hover:text-accent-300 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                    >
                                        Run
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Call Log */}
                {callLogEntries.length > 0 && (
                    <div>
                        <h3 className="text-gray-300 text-xs font-semibold uppercase tracking-wide mb-2">
                            Call Log
                        </h3>
                        <div className="space-y-1">
                            {[...callLogEntries].reverse().map((entry, idx) => (
                                <CallLogItem key={idx} entry={entry} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── ViewModel ────────────────────────────────────────────────────

class MCPClientViewModel implements ViewModel {
    viewType: string = "mcpclient";
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    blockAtom: Atom<Block>;

    viewIcon: Atom<string>;
    viewName: Atom<string>;
    cwdAtom: Atom<string>;

    constructor({ blockId, nodeModel, tabModel }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;

        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = atom("plug");
        this.viewName = atom("MCP Client");

        this.cwdAtom = atom((get) => {
            const block = get(this.blockAtom);
            return (block?.meta?.["cmd:cwd"] as string) || "";
        });
    }

    get viewComponent(): ViewComponent {
        return MCPClientView as ViewComponent;
    }
}

export { MCPClientViewModel };
