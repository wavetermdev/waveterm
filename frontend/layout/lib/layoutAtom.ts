// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WOS } from "@/app/store/global";
import { Atom, atom, Getter } from "jotai";
import { LayoutTreeState, WritableLayoutTreeStateAtom } from "./types";

const layoutStateAtomMap: WeakMap<Atom<Tab>, WritableLayoutTreeStateAtom> = new WeakMap();

function getLayoutStateAtomFromTab(tabAtom: Atom<Tab>, get: Getter): WritableWaveObjectAtom<LayoutState> {
    const tabData = get(tabAtom);
    if (!tabData) return;
    const layoutStateOref = WOS.makeORef("layout", tabData.layoutstate);
    const layoutStateAtom = WOS.getWaveObjectAtom<LayoutState>(layoutStateOref);
    return layoutStateAtom;
}

export function withLayoutTreeStateAtomFromTab(tabAtom: Atom<Tab>): WritableLayoutTreeStateAtom {
    if (layoutStateAtomMap.has(tabAtom)) {
        return layoutStateAtomMap.get(tabAtom);
    }
    const generationAtom = atom(1);
    const treeStateAtom: WritableLayoutTreeStateAtom = atom(
        (get) => {
            const stateAtom = getLayoutStateAtomFromTab(tabAtom, get);
            if (!stateAtom) return;
            const layoutStateData = get(stateAtom);
            const layoutTreeState: LayoutTreeState = {
                rootNode: layoutStateData?.rootnode,
                focusedNodeId: layoutStateData?.focusednodeid,
                magnifiedNodeId: layoutStateData?.magnifiednodeid,
                pendingBackendActions: layoutStateData?.pendingbackendactions,
                generation: get(generationAtom),
            };
            return layoutTreeState;
        },
        (get, set, value) => {
            if (get(generationAtom) < value.generation) {
                const stateAtom = getLayoutStateAtomFromTab(tabAtom, get);
                if (!stateAtom) return;
                const waveObjVal = get(stateAtom);
                waveObjVal.rootnode = value.rootNode;
                waveObjVal.magnifiednodeid = value.magnifiedNodeId;
                waveObjVal.focusednodeid = value.focusedNodeId;
                waveObjVal.leaforder = value.leafOrder; // only set leaforder, never get it, since this value is driven by the frontend
                waveObjVal.pendingbackendactions = value.pendingBackendActions?.length
                    ? value.pendingBackendActions
                    : undefined;
                set(generationAtom, value.generation);
                set(stateAtom, waveObjVal);
            }
        }
    );
    layoutStateAtomMap.set(tabAtom, treeStateAtom);
    return treeStateAtom;
}
