// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TileLayout } from "./lib/TileLayout";
import { LayoutModel } from "./lib/layoutModel";
import {
    deleteLayoutModelForTab,
    getLayoutModelForTab,
    getLayoutModelForTabById,
    useLayoutModel,
    useLayoutNode,
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
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeStateSetter,
    LayoutTreeSwapNodeAction,
} from "./lib/types";
import { DropDirection, LayoutTreeActionType, NavigateDirection } from "./lib/types";

export {
    deleteLayoutModelForTab,
    DropDirection,
    getLayoutModelForTab,
    getLayoutModelForTabById,
    LayoutModel,
    LayoutTreeActionType,
    NavigateDirection,
    newLayoutNode,
    TileLayout,
    useLayoutModel,
    useLayoutNode,
};
export type {
    ContentRenderer,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeClearPendingAction,
    LayoutTreeCommitPendingAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeStateSetter,
    LayoutTreeSwapNodeAction,
};
