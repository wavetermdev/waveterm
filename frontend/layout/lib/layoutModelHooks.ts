// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useOnResize } from "@/app/hook/useDimensions";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
import { Atom, useAtomValue } from "jotai";
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { debounce } from "throttle-debounce";
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
    globalStore.sub(layoutTreeStateAtom, () => fireAndForget(async () => layoutModel.onTreeStateAtomUpdated()));
    layoutModelMap.set(tabId, layoutModel);
    return layoutModel;
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
    useEffect(() => fireAndForget(async () => layoutModel.onTreeStateAtomUpdated(true)), []);

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
        debounce(animationTimeS * 1000, (nodeInnerRect) => {
            setInnerRect(nodeInnerRect);
        }),
        [animationTimeS]
    );

    useLayoutEffect(() => {
        if (prefersReducedMotion || isMagnified || isResizing) {
            setInnerRect(nodeInnerRect);
        } else {
            setInnerRectDebounced(nodeInnerRect);
        }
    }, [nodeInnerRect]);

    return innerRect;
}
