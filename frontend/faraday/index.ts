// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TileLayout } from "./lib/TileLayout";
import { newLayoutTreeStateAtom, useLayoutTreeStateReducerAtom, withLayoutTreeState } from "./lib/layoutAtom";
import { newLayoutNode } from "./lib/layoutNode";
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
} from "./lib/model";
import { LayoutTreeActionType } from "./lib/model";

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
