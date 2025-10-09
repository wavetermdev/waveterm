// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { atom, createStore, type PrimitiveAtom } from "jotai";
import { LayoutModel } from "@/layout/lib/layoutModel";
import { newLayoutNode } from "@/layout/lib/layoutNode";
import { FlexDirection, LayoutTreeActionType } from "@/layout/lib/types";

const layoutStateAtoms = new Map<string, PrimitiveAtom<LayoutState>>();
const storeHolder: { current: ReturnType<typeof createStore> } = {
    current: createStore(),
};

vi.mock("@/app/store/global", () => {
    const { atom } = require("jotai");
    return {
        WOS: {
            makeORef: (_otype: string, oid: string) => oid,
            getWaveObjectAtom: (oid: string) => {
                if (!layoutStateAtoms.has(oid)) {
                    layoutStateAtoms.set(
                        oid,
                        atom<LayoutState>({
                            otype: "layout",
                            oid,
                            version: 1,
                            meta: {},
                            rootnode: undefined,
                            magnifiednodeid: undefined,
                            focusednodeid: undefined,
                            leaforder: undefined,
                            pendingbackendactions: undefined,
                        }),
                    );
                }
                return layoutStateAtoms.get(oid);
            },
        },
        getSettingsKeyAtom: () => atom(0.75),
        globalStore: {
            get: (targetAtom: any) => storeHolder.current.get(targetAtom),
            set: (targetAtom: any, value: any) => storeHolder.current.set(targetAtom, value),
        },
    };
});

function createLayoutModel(): LayoutModel {
    const tabAtom = atom<Tab>({
        otype: "tab",
        oid: "tab-1",
        version: 1,
        meta: {},
        name: "Test Tab",
        layoutstate: "layout-1",
        blockids: [],
    });
    const model = new LayoutModel(tabAtom, storeHolder.current.get, storeHolder.current.set);
    model.getBoundingRect = () => ({
        top: 0,
        left: 0,
        width: 800,
        height: 600,
    });
    model.displayContainerRef.current = {
        getBoundingClientRect: () => ({
            top: 0,
            left: 0,
            width: 800,
            height: 600,
        }),
    } as any;
    return model;
}

describe("LayoutModel", () => {
    beforeEach(() => {
        layoutStateAtoms.clear();
        storeHolder.current = createStore();
    });

    it("creates a root node and focuses it when inserting the first block", () => {
        const model = createLayoutModel();
        const node = newLayoutNode(undefined, undefined, undefined, { blockId: "block-1" });

        model.treeReducer({
            type: LayoutTreeActionType.InsertNode,
            node,
            magnified: false,
            focused: true,
        });

        expect(model.treeState.rootNode?.data?.blockId).toBe("block-1");
        expect(model.treeState.focusedNodeId).toBe(node.id);
        expect(model.treeState.rootNode?.children).toBeUndefined();
    });

    it("splits an existing node horizontally and focuses the new block", () => {
        const model = createLayoutModel();
        const first = newLayoutNode(undefined, undefined, undefined, { blockId: "left" });
        model.treeReducer({
            type: LayoutTreeActionType.InsertNode,
            node: first,
            magnified: false,
            focused: true,
        });

        const second = newLayoutNode(undefined, undefined, undefined, { blockId: "right" });
        model.treeReducer(
            {
                type: LayoutTreeActionType.SplitHorizontal,
                targetNodeId: model.treeState.rootNode!.id,
                newNode: second,
                position: "after",
                focused: true,
            },
            false,
        );

        const root = model.treeState.rootNode!;
        expect(root.flexDirection).toBe(FlexDirection.Row);
        expect(root.children).toHaveLength(2);
        expect(root.children![0].data?.blockId).toBe("left");
        expect(root.children![1].data?.blockId).toBe("right");
        expect(model.treeState.focusedNodeId).toBe(second.id);
    });

    it("commits pending insert actions through the pending action queue", () => {
        const model = createLayoutModel();
        const first = newLayoutNode(undefined, undefined, undefined, { blockId: "primary" });
        model.treeReducer({
            type: LayoutTreeActionType.InsertNode,
            node: first,
            magnified: false,
            focused: true,
        });

        const pending = newLayoutNode(undefined, undefined, undefined, { blockId: "secondary" });
        model.treeReducer(
            {
                type: LayoutTreeActionType.SetPendingAction,
                action: {
                    type: LayoutTreeActionType.InsertNode,
                    node: pending,
                    magnified: false,
                    focused: true,
                },
            },
            false,
        );

        model.treeReducer({ type: LayoutTreeActionType.CommitPendingAction }, false);

        const root = model.treeState.rootNode!;
        const leafBlocks = root.children
            ? root.children.map((child) => child.data?.blockId)
            : [root.data?.blockId];
        expect(leafBlocks).toContain("primary");
        expect(leafBlocks).toContain("secondary");

        const pendingAction = storeHolder.current.get(model.pendingTreeAction.throttledValueAtom);
        expect(pendingAction).toBeUndefined();
    });
});
