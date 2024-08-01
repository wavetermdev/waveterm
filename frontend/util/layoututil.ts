// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { LayoutTreeState } from "frontend/layout/index";

function findLeafIdFromBlockId(layoutTree: LayoutTreeState<TabLayoutData>, blockId: string): string {
    if (layoutTree?.leafs == null) {
        return null;
    }
    for (let leaf of layoutTree.leafs) {
        if (leaf.data.blockId == blockId) {
            return leaf.id;
        }
    }
    return null;
}

function isBlockMagnified(layoutTree: LayoutTreeState<TabLayoutData>, blockId: string): boolean {
    if (layoutTree?.leafs == null || layoutTree.magnifiedNodeId == null) {
        return false;
    }
    for (let leaf of layoutTree.leafs) {
        if (leaf.data.blockId == blockId) {
            return layoutTree.magnifiedNodeId == leaf.id;
        }
    }
    return false;
}

export { findLeafIdFromBlockId, isBlockMagnified };
