// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TileLayout } from "./lib/TileLayout";
import { LayoutModel } from "./lib/layoutModel";
import {
    deleteLayoutModelForTab,
    getLayoutModelForStaticTab,
    getLayoutModelForTab,
    getLayoutModelForTabById,
    useDebouncedNodeInnerRect,
    useLayoutModel,
} from "./lib/layoutModelHooks";
import { newLayoutNode } from "./lib/layoutNode";
import type {
    ContentRenderer,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeClearPendingAction,
    LayoutTreeCommitPendingAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeFocusNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeStateSetter,
    LayoutTreeSwapNodeAction,
    NodeModel,
    PreviewRenderer,
} from "./lib/types";
import { DropDirection, LayoutTreeActionType, NavigateDirection } from "./lib/types";

export {
    deleteLayoutModelForTab,
    DropDirection,
    getLayoutModelForStaticTab,
    getLayoutModelForTab,
    getLayoutModelForTabById,
    LayoutModel,
    LayoutTreeActionType,
    NavigateDirection,
    newLayoutNode,
    TileLayout,
    useDebouncedNodeInnerRect,
    useLayoutModel,
};
export type {
    ContentRenderer,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeClearPendingAction,
    LayoutTreeCommitPendingAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeFocusNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeStateSetter,
    LayoutTreeSwapNodeAction,
    NodeModel,
    PreviewRenderer,
};
