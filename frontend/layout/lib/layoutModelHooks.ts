// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore, WOS } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { Atom, useAtomValue } from "jotai";
import { CSSProperties, useEffect, useState } from "react";
import { withLayoutTreeStateAtomFromTab } from "./layoutAtom";
import { LayoutModel } from "./layoutModel";
import { LayoutNode, NodeModel, TileLayoutContents } from "./types";

const layoutModelMap: Map<string, LayoutModel> = new Map();

export function getLayoutModelForTab(tabAtom: Atom<Tab>): LayoutModel {
    const tabData = globalStore.get(tabAtom);
    if (!tabData) return;
    const tabId = tabData.oid;
    if (layoutModelMap.has(tabId)) {
        const layoutModel = layoutModelMap.get(tabData.oid);
        if (layoutModel) {
            return layoutModel;
        }
    }
    const layoutTreeStateAtom = withLayoutTreeStateAtomFromTab(tabAtom);
    const layoutModel = new LayoutModel(layoutTreeStateAtom, globalStore.get, globalStore.set);
    globalStore.sub(layoutTreeStateAtom, () => fireAndForget(() => layoutModel.updateTreeState()));
    layoutModelMap.set(tabId, layoutModel);
    return layoutModel;
}

export function getLayoutModelForTabById(tabId: string) {
    const tabOref = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabOref);
    return getLayoutModelForTab(tabAtom);
}

export function getLayoutModelForActiveTab() {
    const tabId = globalStore.get(atoms.activeTabId);
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
    useResizeObserver(layoutModel?.displayContainerRef, layoutModel?.onContainerResize);
    useEffect(() => layoutModel.registerTileLayout(tileContent), [tileContent]);
    return layoutModel;
}

export function useNodeModel(layoutModel: LayoutModel, layoutNode: LayoutNode): NodeModel {
    return layoutModel.getNodeModel(layoutNode);
}

export function useDebouncedNodeInnerRect(nodeModel: NodeModel): CSSProperties {
    const nodeInnerRect = useAtomValue(nodeModel.innerRect);
    const nodeIsResizing = useAtomValue(nodeModel.isResizing);

    const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout>();
    const [innerRect, setInnerRect] = useState<CSSProperties>();

    useEffect(() => {
        if (!nodeIsResizing && nodeInnerRect) {
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }
            setDebounceTimeout(
                setTimeout(() => {
                    console.log("setting inner rect", nodeInnerRect);
                    setInnerRect(nodeInnerRect);
                    setDebounceTimeout(null);
                }, nodeModel.animationTimeS * 1000)
            );
        } else {
            setInnerRect(null);
        }
    }, [nodeInnerRect, nodeIsResizing]);

    return innerRect;
}
