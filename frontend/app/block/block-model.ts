// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";

export interface BlockHighlightType {
    blockId: string;
    icon: string;
}

export class BlockModel {
    private static instance: BlockModel | null = null;
    private blockHighlightAtomCache = new Map<string, jotai.Atom<BlockHighlightType | null>>();
    private completionHighlightAtomCache = new Map<string, jotai.Atom<number | null>>();

    blockHighlightAtom: jotai.PrimitiveAtom<BlockHighlightType> = jotai.atom(null) as jotai.PrimitiveAtom<BlockHighlightType>;
    completionHighlightAtom: jotai.PrimitiveAtom<Map<string, number>> = jotai.atom(new Map()) as jotai.PrimitiveAtom<Map<string, number>>;

    private constructor() {}

    getBlockHighlightAtom(blockId: string): jotai.Atom<BlockHighlightType | null> {
        let atom = this.blockHighlightAtomCache.get(blockId);
        if (!atom) {
            atom = jotai.atom((get) => {
                const highlight = get(this.blockHighlightAtom);
                if (highlight?.blockId === blockId) {
                    return highlight;
                }
                return null;
            });
            this.blockHighlightAtomCache.set(blockId, atom);
        }
        return atom;
    }

    setBlockHighlight(highlight: BlockHighlightType | null) {
        globalStore.set(this.blockHighlightAtom, highlight);
    }

    getCompletionHighlightAtom(blockId: string): jotai.Atom<number | null> {
        let atom = this.completionHighlightAtomCache.get(blockId);
        if (!atom) {
            atom = jotai.atom((get) => {
                const map = get(this.completionHighlightAtom);
                return map.get(blockId) ?? null;
            });
            this.completionHighlightAtomCache.set(blockId, atom);
        }
        return atom;
    }

    setCompletionHighlight(blockId: string, exitCode: number) {
        const currentMap = new Map(globalStore.get(this.completionHighlightAtom));
        currentMap.clear();
        currentMap.set(blockId, exitCode);
        globalStore.set(this.completionHighlightAtom, currentMap);
    }

    clearCompletionHighlight(blockId: string) {
        const currentMap = new Map(globalStore.get(this.completionHighlightAtom));
        if (!currentMap.has(blockId)) return;
        currentMap.delete(blockId);
        globalStore.set(this.completionHighlightAtom, currentMap);
    }

    static getInstance(): BlockModel {
        if (!BlockModel.instance) {
            BlockModel.instance = new BlockModel();
        }
        return BlockModel.instance;
    }

    static resetInstance(): void {
        BlockModel.instance = null;
    }
}
