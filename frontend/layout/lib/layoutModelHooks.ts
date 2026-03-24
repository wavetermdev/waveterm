// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useOnResize } from "@/app/hook/useDimensions";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
import { Atom, useAtomValue } from "jotai";
import { CSSProperties, useCallback, useEffect, useState } from "react";
import { getLayoutStateAtomFromTab } from "./layoutAtom";
import { LayoutModel } from "./layoutModel";
import { LayoutNode, NodeModel, TileLayoutContents } from "./types";

const layoutModelMap: Map<string, LayoutModel> = new Map();

function getLayoutModelForTab(tabAtom: Atom<Tab>): LayoutModel {
    const tabData = globalStore.get(tabAtom);
    if (!tabData) return;
    const tabId = tabData.oid;
    if (layoutModelMap.has(tabId)) {
        const layoutModel = layoutModelMap.get(tabData.oid);
        if (layoutModel) {
            return layoutModel;
        }
    }
    const layoutModel = new LayoutModel(tabAtom, globalStore.get, globalStore.set);
    
    const staticTabId = globalStore.get(atoms.staticTabId);
    if (tabId === staticTabId) {
        const layoutStateAtom = getLayoutStateAtomFromTab(tabAtom, globalStore.get);
        globalStore.sub(layoutStateAtom, () => {
            layoutModel.onBackendUpdate();
        });
    }
    
    layoutModelMap.set(tabId, layoutModel);
    return layoutModel;
}

function getLayoutModelForTabById(tabId: string) {
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

function useLayoutModel(tabAtom: Atom<Tab>): LayoutModel {
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
    const [innerRectDebounceTimeout, setInnerRectDebounceTimeout] = useState<NodeJS.Timeout>();

    const setInnerRectDebounced = useCallback(
        (nodeInnerRect: CSSProperties) => {
            clearInnerRectDebounce();
            setInnerRectDebounceTimeout(
                setTimeout(() => {
                    setInnerRect(nodeInnerRect);
                }, animationTimeS * 1000)
            );
        },
        [animationTimeS]
    );
    const clearInnerRectDebounce = useCallback(() => {
        if (innerRectDebounceTimeout) {
            clearTimeout(innerRectDebounceTimeout);
            setInnerRectDebounceTimeout(undefined);
        }
    }, [innerRectDebounceTimeout]);

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
