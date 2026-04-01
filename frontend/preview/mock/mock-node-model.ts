// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { NodeModel } from "@/layout/index";
import { atom } from "jotai";

export type MockNodeModelOpts = {
    nodeId: string;
    blockId: string;
    innerRect?: { width: string; height: string };
    numLeafs?: number;
};

export function makeMockNodeModel(opts: MockNodeModelOpts): NodeModel {
    const isFocusedAtom = atom(true);
    const isMagnifiedAtom = atom(false);

    return {
        additionalProps: atom({} as any),
        innerRect: atom(opts.innerRect ?? { width: "1000px", height: "640px" }),
        blockNum: atom(1),
        numLeafs: atom(opts.numLeafs ?? 1),
        nodeId: opts.nodeId,
        blockId: opts.blockId,
        addEphemeralNodeToLayout: () => {},
        animationTimeS: atom(0),
        isResizing: atom(false),
        isFocused: isFocusedAtom,
        isMagnified: isMagnifiedAtom,
        anyMagnified: atom((get) => get(isMagnifiedAtom)),
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
