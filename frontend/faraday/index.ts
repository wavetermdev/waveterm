// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TileLayout } from "./lib/TileLayout.jsx";
import { newLayoutTreeStateAtom, useLayoutTreeStateReducerAtom, withLayoutTreeState } from "./lib/layoutAtom.js";
import { newLayoutNode } from "./lib/layoutNode.js";
import type {
    LayoutNode,
    LayoutTreeCommitPendingAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeState,
    WritableLayoutNodeAtom,
    WritableLayoutTreeStateAtom,
} from "./lib/model.js";
import { LayoutTreeActionType } from "./lib/model.js";

export {
    LayoutTreeActionType,
    TileLayout,
    newLayoutNode,
    newLayoutTreeStateAtom,
    useLayoutTreeStateReducerAtom,
    withLayoutTreeState,
};
export type {
    LayoutNode,
    LayoutTreeCommitPendingAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeState,
    WritableLayoutNodeAtom,
    WritableLayoutTreeStateAtom,
};
