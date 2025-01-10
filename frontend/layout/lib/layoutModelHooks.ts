// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useOnResize } from "@/app/hook/useDimensions";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
import { Atom, useAtomValue } from "jotai";
import { CSSProperties, useCallback, useEffect, useState } from "react";
import { withLayoutTreeStateAtomFromTab } from "./layoutAtom";
import { LayoutModel } from "./layoutModel";
import { LayoutNode, NodeModel, TileLayoutContents } from "./types";

const layoutModelMap: Map<string, LayoutModel> = new Map();
const timeoutMap: Map<string, NodeJS.Timeout | null> = new Map();

export function getLayoutModelForTab(tabAtom: Atom<Tab>): LayoutModel {
    const tabData = globalStore.get(tabAtom);
    if (!tabData) return;
    const tabId = tabData.oid;
    return computeIfAbsent(layoutModelMap, tabId, (_) => {
        const layoutTreeStateAtom = withLayoutTreeStateAtomFromTab(tabAtom);
        const layoutModel = new LayoutModel(layoutTreeStateAtom, globalStore.get, globalStore.set);
        globalStore.sub(layoutTreeStateAtom, () => fireAndForget(layoutModel.onTreeStateAtomUpdated.bind(layoutModel)));
        return layoutModel;
    })
}

export function getLayoutModelForTabById(tabId: string) {
    const tabOref = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabOref);
    return getLayoutModelForTab(tabAtom);
}

export function getLayoutModelForStaticTab() {
    const tabId = globalStore.get(atoms.staticTabId);
    return getLayoutModelForTabById(tabId);
}

export function deleteLayoutModelForTab(tabId: string) {
    if (layoutModelMap.has(tabId)) layoutModelMap.delete(tabId);
}

export function useLayoutModel(tabAtom: Atom<Tab>): LayoutModel {
    return getLayoutModelForTab(tabAtom);
}

export function useTileLayout(tabAtom: Atom<Tab>, tileContent: TileLayoutContents): LayoutModel {
    // Use tab data to ensure we can reload if the tab is disposed and remade (such as during Hot Module Reloading)
    useAtomValue(tabAtom);
    const layoutModel = useLayoutModel(tabAtom);

    useOnResize(layoutModel?.displayContainerRef, layoutModel?.onContainerResize);

    // Once the TileLayout is mounted, re-run the state update to get all the nodes to flow in the layout.
    useEffect(() => fireAndForget(() => layoutModel.onTreeStateAtomUpdated(true)), []);

    useEffect(() => layoutModel.registerTileLayout(tileContent), [tileContent]);
    return layoutModel;
}

export function useNodeModel(layoutModel: LayoutModel, layoutNode: LayoutNode): NodeModel {
    return layoutModel.getNodeModel(layoutNode);
}

export function useDebouncedNodeInnerRect(nodeModel: NodeModel): CSSProperties {
    const nodeInnerRect = useAtomValue(nodeModel.innerRect);
    const animationTimeS = useAtomValue(nodeModel.animationTimeS);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const isResizing = useAtomValue(nodeModel.isResizing);
    const prefersReducedMotion = useAtomValue(atoms.prefersReducedMotionAtom);
    const [innerRect, setInnerRect] = useState<CSSProperties>();

    const setInnerRectDebounced = useCallback(
        (nodeInnerRect: CSSProperties) => {
            clearInnerRectDebounce();
            const timeout = setTimeout(() => {
                setInnerRect(nodeInnerRect);
            }, animationTimeS * 1000);
            computeIfAbsent(timeoutMap, nodeModel.blockId, (_) => timeout)
        },
        [animationTimeS]
    );
    const clearInnerRectDebounce = function () {
        if (timeoutMap.has(nodeModel.blockId)) {
            const innerRectDebounceTimeout = timeoutMap.get(nodeModel.blockId);
            if (innerRectDebounceTimeout) {
                clearTimeout(innerRectDebounceTimeout);
            }
            timeoutMap.delete(nodeModel.blockId);
        }
    };

    useEffect(() => {
        if (prefersReducedMotion || isMagnified || isResizing) {
            clearInnerRectDebounce();
            setInnerRect(nodeInnerRect);
        } else {
            setInnerRectDebounced(nodeInnerRect);
        }
    }, [nodeInnerRect]);

    return innerRect;
}

function computeIfAbsent<V, F>(map: Map<V, F>, key: V, mappingFunction: (a: V) => F): F {
    if (!map.has(key)) {
        const newValue = mappingFunction(key);
        map.set(key, newValue);
    }
    return map.get(key);
}
