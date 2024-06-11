// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WOS } from "@/app/store/global.js";
import { Atom, Getter, PrimitiveAtom, WritableAtom, atom, useAtom } from "jotai";
import { useCallback } from "react";
import { layoutTreeStateReducer, newLayoutTreeState } from "./layoutState.js";
import {
    LayoutNode,
    LayoutNodeWaveObj,
    LayoutTreeAction,
    LayoutTreeState,
    WritableLayoutNodeAtom,
    WritableLayoutTreeStateAtom,
} from "./model.js";

/**
 * Creates a new layout tree state wrapped as an atom.
 * @param rootNode The root node for the tree.
 * @returns The state wrapped as an atom.
 *
 * @template T The type of data associated with the nodes of the tree.
 */
export function newLayoutTreeStateAtom<T>(rootNode: LayoutNode<T>): PrimitiveAtom<LayoutTreeState<T>> {
    return atom(newLayoutTreeState(rootNode)) as PrimitiveAtom<LayoutTreeState<T>>;
}

/**
 * Derives a WritableLayoutTreeStateAtom from a WritableLayoutNodeAtom, initializing the tree state.
 * @param layoutNodeAtom The atom containing the root node for the LayoutTreeState.
 * @returns The derived WritableLayoutTreeStateAtom.
 */
export function withLayoutTreeState<T>(layoutNodeAtom: WritableLayoutNodeAtom<T>): WritableLayoutTreeStateAtom<T> {
    const pendingActionAtom = atom<LayoutTreeAction>(null) as PrimitiveAtom<LayoutTreeAction>;
    const generationAtom = atom(0) as PrimitiveAtom<number>;
    return atom(
        (get) => {
            const layoutState = newLayoutTreeState(get(layoutNodeAtom));
            layoutState.pendingAction = get(pendingActionAtom);
            layoutState.generation = get(generationAtom);
            return layoutState;
        },
        (get, set, value) => {
            set(pendingActionAtom, value.pendingAction);
            if (get(generationAtom) !== value.generation) {
                set(generationAtom, value.generation);
                set(layoutNodeAtom, value.rootNode);
            }
        }
    );
}

/**
 * Hook to subscribe to the tree state and dispatch actions to its reducer functon.
 * @param layoutTreeStateAtom The atom holding the layout tree state.
 * @returns The current state of the tree and the dispatch function.
 */
export function useLayoutTreeStateReducerAtom<T>(
    layoutTreeStateAtom: WritableLayoutTreeStateAtom<T>
): readonly [LayoutTreeState<T>, (action: LayoutTreeAction) => void] {
    const [state, setState] = useAtom(layoutTreeStateAtom);
    const dispatch = useCallback(
        (action: LayoutTreeAction) => setState(layoutTreeStateReducer(state, action)),
        [state, setState]
    );
    return [state, dispatch];
}

const tabLayoutAtomCache = new Map<string, WritableLayoutTreeStateAtom<TabLayoutData>>();

function getLayoutNodeWaveObjAtomFromTab<T>(
    tabAtom: Atom<Tab>,
    get: Getter
): WritableAtom<LayoutNodeWaveObj<T>, [value: LayoutNodeWaveObj<T>], void> {
    const tabValue = get(tabAtom);
    // console.log("getLayoutNodeWaveObjAtomFromTab tabValue", tabValue);
    if (!tabValue) return;
    const layoutNodeOref = WOS.makeORef("layout", tabValue.layoutNode);
    // console.log("getLayoutNodeWaveObjAtomFromTab oref", layoutNodeOref);
    return WOS.getWaveObjectAtom<LayoutNodeWaveObj<T>>(layoutNodeOref);
}

export function withLayoutStateAtomFromTab<T>(tabAtom: Atom<Tab>): WritableLayoutTreeStateAtom<T> {
    const pendingActionAtom = atom<LayoutTreeAction>(null) as PrimitiveAtom<LayoutTreeAction>;
    const generationAtom = atom(0) as PrimitiveAtom<number>;
    return atom(
        (get) => {
            const waveObjAtom = getLayoutNodeWaveObjAtomFromTab<T>(tabAtom, get);
            if (!waveObjAtom) return null;
            const layoutState = newLayoutTreeState(get(waveObjAtom)?.node);
            layoutState.pendingAction = get(pendingActionAtom);
            layoutState.generation = get(generationAtom);
            return layoutState;
        },
        (get, set, value) => {
            set(pendingActionAtom, value.pendingAction);
            if (get(generationAtom) !== value.generation) {
                const waveObjAtom = getLayoutNodeWaveObjAtomFromTab<T>(tabAtom, get);
                if (!waveObjAtom) return;
                const newWaveObj = { ...get(waveObjAtom), node: value.rootNode };
                set(generationAtom, value.generation);
                set(waveObjAtom, newWaveObj);
            }
        }
    );
}

export function getLayoutStateAtomForTab(
    tabId: string,
    tabAtom: WritableAtom<Tab, [value: Tab], void>
): WritableLayoutTreeStateAtom<TabLayoutData> {
    let atom = tabLayoutAtomCache.get(tabId);
    if (atom) {
        // console.log("Reusing atom for tab", tabId);
        return atom;
    }
    // console.log("Creating new atom for tab", tabId);
    atom = withLayoutStateAtomFromTab<TabLayoutData>(tabAtom);
    tabLayoutAtomCache.set(tabId, atom);
    return atom;
}

export function deleteLayoutStateAtomForTab(tabId: string) {
    const atom = tabLayoutAtomCache.get(tabId);
    if (atom) {
        tabLayoutAtomCache.delete(tabId);
    }
}
