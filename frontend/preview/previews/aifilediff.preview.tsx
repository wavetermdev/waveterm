// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import type { NodeModel } from "@/layout/index";
import { atom } from "jotai";
import * as React from "react";
import { useRpcOverride } from "../mock/use-rpc-override";
import {
    DefaultAiFileDiffChatId,
    DefaultAiFileDiffFileName,
    DefaultAiFileDiffToolCallId,
    makeMockAiFileDiffResponse,
} from "./aifilediff.preview-util";

const PreviewNodeId = "preview-aifilediff-node";

function makePreviewNodeModel(blockId: string): NodeModel {
    const isFocusedAtom = atom(true);
    const isMagnifiedAtom = atom(false);

    return {
        additionalProps: atom({} as any),
        innerRect: atom({ width: "1000px", height: "640px" }),
        blockNum: atom(1),
        numLeafs: atom(1),
        nodeId: PreviewNodeId,
        blockId,
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

export function AiFileDiffPreview() {
    const env = useWaveEnv();
    const [blockId, setBlockId] = React.useState<string>(null);

    useRpcOverride("WaveAIGetToolDiffCommand", async (_client, data) => {
        if (data.chatid !== DefaultAiFileDiffChatId || data.toolcallid !== DefaultAiFileDiffToolCallId) {
            return null;
        }
        return makeMockAiFileDiffResponse();
    });

    React.useEffect(() => {
        env.createBlock(
            {
                meta: {
                    view: "aifilediff",
                    file: DefaultAiFileDiffFileName,
                    "aifilediff:chatid": DefaultAiFileDiffChatId,
                    "aifilediff:toolcallid": DefaultAiFileDiffToolCallId,
                },
            },
            false,
            false
        ).then((id) => setBlockId(id));
    }, []);

    const nodeModel = React.useMemo(() => (blockId != null ? makePreviewNodeModel(blockId) : null), [blockId]);

    if (blockId == null || nodeModel == null) {
        return null;
    }

    return (
        <div className="flex w-full max-w-[1120px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">full aifilediff block (mock WOS + mock WaveAI diff RPC)</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[720px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
