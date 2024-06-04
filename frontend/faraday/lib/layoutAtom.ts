// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PrimitiveAtom, WritableAtom, atom, useAtom } from "jotai";
import { useCallback } from "react";
import { layoutTreeStateReducer, newLayoutTreeState } from "./layoutState.js";
import {
    LayoutNode,
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
    return atom(
        (get) => newLayoutTreeState(get(layoutNodeAtom)),
        (_get, set, value) => set(layoutNodeAtom, value.rootNode)
    );
}

export function withLayoutStateFromTab(
    tabAtom: WritableAtom<Tab, [value: Tab], void>
): WritableLayoutTreeStateAtom<TabLayoutData> {
    return atom(
        (get) => {
            const tabData = get(tabAtom);
            console.log("get layout state from tab", tabData);
            return newLayoutTreeState(tabData?.layout);
        },
        (get, set, value) => {
            const tabValue = get(tabAtom);
            const newTabValue = { ...tabValue };
            newTabValue.layout = value.rootNode;
            console.log("set tab", tabValue, value);
            set(tabAtom, newTabValue);
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

export function getLayoutStateAtomForTab(
    tabId: string,
    tabAtom: WritableAtom<Tab, [value: Tab], void>
): WritableLayoutTreeStateAtom<TabLayoutData> {
    let atom = tabLayoutAtomCache.get(tabId);
    if (atom) {
        console.log("Reusing atom for tab", tabId);
        return atom;
    }
    console.log("Creating new atom for tab", tabId);
    atom = withLayoutStateFromTab(tabAtom);
    tabLayoutAtomCache.set(tabId, atom);
    return atom;
}

export function deleteLayoutStateAtomForTab(tabId: string) {
    const atom = tabLayoutAtomCache.get(tabId);
    if (atom) {
        tabLayoutAtomCache.delete(tabId);
    }
}
