// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { WOS } from "@/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";
import { WaveAIModel } from "./waveai-model";

type MCPDetectInfo = {
    found: boolean;
    serverName?: string;
    serverVersion?: string;
    toolCount?: number;
    cwd?: string;
};

async function detectMCPInCwd(cwd: string): Promise<MCPDetectInfo> {
    try {
        const resp = await fetch(getWebServerEndpoint() + `/wave/mcp/status?cwd=${encodeURIComponent(cwd)}`);
        const data = await resp.json();
        if (data.connected || data.tools) {
            return {
                found: true,
                serverName: data.serverInfo?.name || data.serverName,
                serverVersion: data.serverInfo?.version,
                toolCount: data.tools?.length || 0,
                cwd,
            };
        }
        // Server config exists but couldn't connect — still show banner
        if (!data.error?.includes("no .mcp.json")) {
            return {
                found: true,
                serverName: data.serverName,
                cwd,
            };
        }
        return { found: false };
    } catch {
        return { found: false };
    }
}

function getTerminalCwdFromTab(tabId: string): string | null {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(`tab:${tabId}`);
    const tab = globalStore.get(tabAtom);
    if (!tab?.blockids) return null;

    for (const blockId of tab.blockids) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        const block = globalStore.get(blockAtom);
        if (!block?.meta) continue;
        const viewType = block.meta["view"] as string;
        if (viewType !== "term") continue;
        const cwd = block.meta["cmd:cwd"] as string;
        if (cwd) return cwd;
    }
    return null;
}

export const MCPDetectBanner = memo(({ tabId }: { tabId: string }) => {
    const model = WaveAIModel.getInstance();
    const mcpEnabled = useAtomValue(model.mcpContextAtom);
    const [detectInfo, setDetectInfo] = useState<MCPDetectInfo | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (mcpEnabled || dismissed) {
            setDetectInfo(null);
            return;
        }

        const cwd = getTerminalCwdFromTab(tabId);
        if (!cwd) {
            setDetectInfo(null);
            return;
        }

        let cancelled = false;
        detectMCPInCwd(cwd).then((info) => {
            if (!cancelled) {
                setDetectInfo(info);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [tabId, mcpEnabled, dismissed]);

    const handleConnect = useCallback(() => {
        model.setMCPContext(true);
        setDetectInfo(null);
    }, [model]);

    const handleDismiss = useCallback(() => {
        setDismissed(true);
        setDetectInfo(null);
    }, []);

    if (!detectInfo?.found || mcpEnabled) {
        return null;
    }

    const serverLabel = detectInfo.serverName
        ? `${detectInfo.serverName}${detectInfo.serverVersion ? ` v${detectInfo.serverVersion}` : ""}`
        : ".mcp.json";

    return (
        <div className="mx-2 mt-2 p-2.5 bg-accent-900/30 border border-accent-700/50 rounded-lg flex items-center gap-2 text-xs">
            <i className="fa fa-plug text-accent-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <span className="text-gray-200">
                    Found <span className="text-white font-medium">{serverLabel}</span>
                </span>
                {detectInfo.toolCount ? (
                    <span className="text-gray-400"> ({detectInfo.toolCount} tools)</span>
                ) : null}
            </div>
            <button
                onClick={handleConnect}
                className="bg-accent-600 hover:bg-accent-500 text-white px-2.5 py-1 rounded text-xs cursor-pointer transition-colors flex-shrink-0"
            >
                Connect
            </button>
            <button
                onClick={handleDismiss}
                className="text-gray-400 hover:text-white cursor-pointer transition-colors flex-shrink-0"
                title="Dismiss"
            >
                <i className="fa fa-times" />
            </button>
        </div>
    );
});

MCPDetectBanner.displayName = "MCPDetectBanner";

export const MCPConnectInput = memo(() => {
    const model = WaveAIModel.getInstance();
    const showInput = useAtomValue(model.showMCPConnectInput);
    const [inputCwd, setInputCwd] = useState("");

    const handleConnect = useCallback(() => {
        if (!inputCwd.trim()) return;
        model.setMCPCwd(inputCwd.trim());
        model.setMCPContext(true);
        globalStore.set(model.showMCPConnectInput, false);
        setInputCwd("");
    }, [inputCwd, model]);

    const handleCancel = useCallback(() => {
        globalStore.set(model.showMCPConnectInput, false);
        setInputCwd("");
    }, [model]);

    if (!showInput) return null;

    return (
        <div className="mx-2 mt-2 p-2.5 bg-gray-800 border border-gray-600 rounded-lg text-xs">
            <div className="flex items-center gap-2 mb-2">
                <i className="fa fa-plug text-accent-400" />
                <span className="text-gray-200">Connect to MCP server</span>
            </div>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={inputCwd}
                    onChange={(e) => setInputCwd(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleConnect();
                        if (e.key === "Escape") handleCancel();
                    }}
                    placeholder="/path/to/project (with .mcp.json)"
                    className="flex-1 bg-gray-900 text-gray-200 text-xs font-mono px-2 py-1.5 rounded border border-gray-600 focus:border-accent-500 focus:outline-none"
                    spellCheck={false}
                    autoFocus
                />
                <button
                    onClick={handleConnect}
                    disabled={!inputCwd.trim()}
                    className="bg-accent-600 hover:bg-accent-500 disabled:bg-gray-600 text-white px-2.5 py-1 rounded text-xs cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                    Connect
                </button>
                <button
                    onClick={handleCancel}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors"
                >
                    <i className="fa fa-times" />
                </button>
            </div>
        </div>
    );
});

MCPConnectInput.displayName = "MCPConnectInput";
