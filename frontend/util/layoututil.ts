// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { LayoutTreeState } from "@/faraday/index";

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

export { findLeafIdFromBlockId };
