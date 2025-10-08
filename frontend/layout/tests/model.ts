// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { LayoutNode, LayoutTreeState } from "../lib/types";

export function newLayoutTreeState(rootNode: LayoutNode): LayoutTreeState {
    return {
        rootNode,
        pendingBackendActions: [],
    };
}
