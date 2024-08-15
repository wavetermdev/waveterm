import { globalStore, WOS } from "@/app/store/global";
import useResizeObserver from "@react-hook/resize-observer";
import { atom, Atom, useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { withLayoutTreeStateAtomFromTab } from "./layoutAtom";
import { LayoutModel, LayoutNodeAdditionalProps } from "./layoutModel";
import { LayoutNode, TileLayoutContents } from "./types";

const layoutModelMap: Map<string, LayoutModel> = new Map();

export function getLayoutModelForTab(tabAtom: Atom<Tab>): LayoutModel {
    const tabData = globalStore.get(tabAtom);
    if (!tabData) return;
    const tabId = tabData.oid;
    if (layoutModelMap.has(tabId)) {
        const layoutModel = layoutModelMap.get(tabData.oid);
        if (layoutModel) {
            if (!layoutModel.generationAtom) layoutModel.generationAtom = atom(0);
            return layoutModel;
        }
    }
    const layoutTreeStateAtom = withLayoutTreeStateAtomFromTab(tabAtom);
    const layoutModel = new LayoutModel(layoutTreeStateAtom, globalStore.get, globalStore.set);
    globalStore.sub(layoutTreeStateAtom, () => layoutModel.updateTreeState());
    layoutModelMap.set(tabId, layoutModel);
    return layoutModel;
}

export function getLayoutModelForTabById(tabId: string) {
    const tabOref = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabOref);
    return getLayoutModelForTab(tabAtom);
}

export function deleteLayoutModelForTab(tabId: string) {
    if (layoutModelMap.has(tabId)) layoutModelMap.delete(tabId);
}

export function useLayoutModel(tabAtom: Atom<Tab>): LayoutModel {
    return getLayoutModelForTab(tabAtom);
}

export function useTileLayout(tabAtom: Atom<Tab>, tileContent: TileLayoutContents): LayoutModel {
    const layoutModel = useLayoutModel(tabAtom);
    useResizeObserver(layoutModel?.displayContainerRef, layoutModel?.onContainerResize);
    useEffect(() => layoutModel.registerTileLayout(tileContent), [tileContent]);
    return layoutModel;
}

export function useLayoutNode(layoutModel: LayoutModel, layoutNode: LayoutNode): LayoutNodeAdditionalProps {
    const [addlPropsAtom] = useState(layoutModel.getNodeAdditionalPropertiesAtom(layoutNode.id));
    const addlProps = useAtomValue(addlPropsAtom);
    return addlProps;
}
