// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockComponentModel } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { focusedBlockId } from "@/util/focusutil";
import { Atom, atom } from "jotai";

export class FocusManager {
    private static instance: FocusManager | null = null;

    blockFocusAtom: Atom<string | null>;

    private constructor() {
        this.blockFocusAtom = atom((get) => {
            const layoutModel = getLayoutModelForStaticTab();
            const lnode = get(layoutModel.focusedNode);
            return lnode?.data?.blockId;
        });
    }

    static getInstance(): FocusManager {
        if (!FocusManager.instance) {
            FocusManager.instance = new FocusManager();
        }
        return FocusManager.instance;
    }

    nodeFocusWithin(): boolean {
        return focusedBlockId() != null;
    }

    refocusNode() {
        const layoutModel = getLayoutModelForStaticTab();
        const lnode = globalStore.get(layoutModel.focusedNode);
        if (lnode == null || lnode.data?.blockId == null) {
            return;
        }
        layoutModel.focusNode(lnode.id);
        const blockId = lnode.data.blockId;
        const bcm = getBlockComponentModel(blockId);
        const ok = bcm?.viewModel?.giveFocus?.();
        if (!ok) {
            const inputElem = document.getElementById(`${blockId}-dummy-focus`);
            inputElem?.focus();
        }
    }
}
