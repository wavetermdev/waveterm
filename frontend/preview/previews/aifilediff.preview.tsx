// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import type { NodeModel } from "@/layout/index";
import { atom } from "jotai";
import * as React from "react";
import { applyMockEnvOverrides, MockWaveEnv } from "../mock/mockwaveenv";
import {
    DefaultAiFileDiffChatId,
    DefaultAiFileDiffFileName,
    DefaultAiFileDiffToolCallId,
    makeMockAiFileDiffResponse,
} from "./aifilediff.preview-util";

const PreviewWorkspaceId = "preview-aifilediff-workspace";
const PreviewTabId = "preview-aifilediff-tab";
const PreviewNodeId = "preview-aifilediff-node";
const PreviewBlockId = "preview-aifilediff-block";

function makeMockWorkspace(): Workspace {
    return {
        otype: "workspace",
        oid: PreviewWorkspaceId,
        version: 1,
        name: "Preview Workspace",
        tabids: [PreviewTabId],
        activetabid: PreviewTabId,
        meta: {},
    } as Workspace;
}

function makeMockTab(): Tab {
    return {
        otype: "tab",
        oid: PreviewTabId,
        version: 1,
        name: "AI File Diff Preview",
        blockids: [PreviewBlockId],
        meta: {},
    } as Tab;
}

function makeMockBlock(): Block {
    return {
        otype: "block",
        oid: PreviewBlockId,
        version: 1,
        meta: {
            view: "aifilediff",
            file: DefaultAiFileDiffFileName,
            "aifilediff:chatid": DefaultAiFileDiffChatId,
            "aifilediff:toolcallid": DefaultAiFileDiffToolCallId,
        },
    } as Block;
}

function makePreviewNodeModel(): NodeModel {
    const isFocusedAtom = atom(true);
    const isMagnifiedAtom = atom(false);

    return {
        additionalProps: atom({} as any),
        innerRect: atom({ width: "1000px", height: "640px" }),
        blockNum: atom(1),
        numLeafs: atom(1),
        nodeId: PreviewNodeId,
        blockId: PreviewBlockId,
        addEphemeralNodeToLayout: () => {},
        animationTimeS: atom(0),
        isResizing: atom(false),
        isFocused: isFocusedAtom,
        isMagnified: isMagnifiedAtom,
        anyMagnified: atom(false),
        isEphemeral: atom(false),
        ready: atom(true),
        disablePointerEvents: atom(false),
        toggleMagnify: () => {
            globalStore.set(isMagnifiedAtom, !globalStore.get(isMagnifiedAtom));
        },
        focusNode: () => {
            globalStore.set(isFocusedAtom, true);
        },
        onClose: () => {},
        dragHandleRef: { current: null },
        displayContainerRef: { current: null },
    };
}

function AiFileDiffPreviewInner() {
    const baseEnv = useWaveEnv();
    const nodeModel = React.useMemo(() => makePreviewNodeModel(), []);

    const env = React.useMemo<MockWaveEnv>(() => {
        const mockWaveObjs: Record<string, WaveObj> = {
            [`workspace:${PreviewWorkspaceId}`]: makeMockWorkspace(),
            [`tab:${PreviewTabId}`]: makeMockTab(),
            [`block:${PreviewBlockId}`]: makeMockBlock(),
        };

        return applyMockEnvOverrides(baseEnv, {
            tabId: PreviewTabId,
            mockWaveObjs,
            atoms: {
                workspaceId: atom(PreviewWorkspaceId),
                staticTabId: atom(PreviewTabId),
            },
            rpc: {
                WaveAIGetToolDiffCommand: async (_client, data) => {
                    if (
                        data.chatid !== DefaultAiFileDiffChatId ||
                        data.toolcallid !== DefaultAiFileDiffToolCallId
                    ) {
                        return null;
                    }
                    return makeMockAiFileDiffResponse();
                },
            },
        });
    }, [baseEnv]);

    const tabModel = React.useMemo(() => getTabModelByTabId(PreviewTabId, env), [env]);

    return (
        <WaveEnvContext.Provider value={env}>
            <TabModelContext.Provider value={tabModel}>
                <div className="flex w-full max-w-[1120px] flex-col gap-2 px-6 py-6">
                    <div className="text-xs text-muted font-mono">full aifilediff block (mock WOS + mock WaveAI diff RPC)</div>
                    <div className="rounded-md border border-border bg-panel p-4">
                        <div className="h-[720px]">
                            <Block preview={false} nodeModel={nodeModel} />
                        </div>
                    </div>
                </div>
            </TabModelContext.Provider>
        </WaveEnvContext.Provider>
    );
}

export function AiFileDiffPreview() {
    return <AiFileDiffPreviewInner />;
}
