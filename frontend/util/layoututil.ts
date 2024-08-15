// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { LayoutModel } from "@/layout/index";

function findLeafIdFromBlockId(layoutModel: LayoutModel, blockId: string): string {
    if (layoutModel?.leafs == null) {
        return null;
    }
    for (const leaf of layoutModel.leafs) {
        if (leaf.data.blockId == blockId) {
            return leaf.id;
        }
    }
    return null;
}

function isBlockMagnified(layoutModel: LayoutModel, blockId: string): boolean {
    if (layoutModel?.leafs == null || layoutModel.treeState.magnifiedNodeId == null) {
        return false;
    }
    for (const leaf of layoutModel.leafs) {
        if (leaf.data.blockId == blockId) {
            return layoutModel.treeState.magnifiedNodeId == leaf.id;
        }
    }
    return false;
}

export { findLeafIdFromBlockId, isBlockMagnified };
