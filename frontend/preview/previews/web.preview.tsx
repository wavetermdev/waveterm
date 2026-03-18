// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import type { NodeModel } from "@/layout/index";
import { atom } from "jotai";
import * as React from "react";
import { WebBlockId } from "../mock/mockwaveenv";

const PreviewNodeId = "preview-web-node";

function makePreviewNodeModel(): NodeModel {
    const isFocusedAtom = atom(true);
    const isMagnifiedAtom = atom(false);

    return {
        additionalProps: atom({} as any),
        innerRect: atom({ width: "1040px", height: "620px" }),
        blockNum: atom(1),
        numLeafs: atom(1),
        nodeId: PreviewNodeId,
        blockId: WebBlockId,
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

export function WebPreview() {
    const nodeModel = React.useMemo(() => makePreviewNodeModel(), []);

    return (
        <div className="flex w-full max-w-[1100px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">full web block using preview mock fallback</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[680px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
