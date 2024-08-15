// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WritableAtom } from "jotai";
import { CSSProperties } from "react";
import { Dimensions, DropDirection, FlexDirection } from "./utils.js";

/**
 * Represents an operation to insert a node into a tree.
 */
export type MoveOperation = {
    /**
     * The index at which the node will be inserted in the parent.
     */
    index: number;

    /**
     * The parent node. Undefined if inserting at root.
     */
    parentId?: string;

    /**
     * Whether the node will be inserted at the root of the tree.
     */
    insertAtRoot?: boolean;

    /**
     * The node to insert.
     */
    node: LayoutNode;
};

/**
 * Types of actions that modify the layout tree.
 */
export enum LayoutTreeActionType {
    ComputeMove = "computemove",
    Move = "move",
    Swap = "swap",
    SetPendingAction = "setpending",
    CommitPendingAction = "commitpending",
    ClearPendingAction = "clearpending",
    ResizeNode = "resize",
    InsertNode = "insert",
    InsertNodeAtIndex = "insertatindex",
    DeleteNode = "delete",
    MagnifyNodeToggle = "magnify",
}

/**
 * Base class for actions that modify the layout tree.
 */
export interface LayoutTreeAction {
    type: LayoutTreeActionType;
}

/**
 * Action for computing a move operation and saving it as a pending action in the tree state.
 *
 * @see MoveOperation
 * @see LayoutTreeMoveNodeAction
 */
export interface LayoutTreeComputeMoveNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.ComputeMove;
    node: LayoutNode;
    nodeToMove: LayoutNode;
    direction: DropDirection;
}

/**
 * Action for moving a node within the layout tree.
 *
 * @see MoveOperation
 */
export interface LayoutTreeMoveNodeAction extends LayoutTreeAction, MoveOperation {
    type: LayoutTreeActionType.Move;
}

/**
 * Action for swapping two nodes within the layout tree.
 *
 */
export interface LayoutTreeSwapNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.Swap;

    /**
     * The node that node2 will replace.
     */
    node1Id: string;
    /**
     * The node that node1 will replace.
     */
    node2Id: string;
}

/**
 * Action for inserting a new node to the layout tree.
 *
 */
export interface LayoutTreeInsertNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.InsertNode;
    node: LayoutNode;
}

/**
 * Action for inserting a node into the layout tree at the specified index.
 */
export interface LayoutTreeInsertNodeAtIndexAction extends LayoutTreeAction {
    type: LayoutTreeActionType.InsertNodeAtIndex;
    /**
     * The node to insert.
     */
    node: LayoutNode;
    /**
     * The array of indices to traverse when inserting the node.
     * The last index is the index within the parent node where the node should be inserted.
     */
    indexArr: number[];
}

/**
 * Action for deleting a node from the layout tree.
 */
export interface LayoutTreeDeleteNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.DeleteNode;
    nodeId: string;
}

/**
 * Action for setting the pendingAction field of the layout tree state.
 */
export interface LayoutTreeSetPendingAction extends LayoutTreeAction {
    type: LayoutTreeActionType.SetPendingAction;

    /**
     * The new value for the pending action field.
     */
    action: LayoutTreeAction;
}

/**
 * Action for committing the action in the pendingAction field of the layout tree state.
 */
export interface LayoutTreeCommitPendingAction extends LayoutTreeAction {
    type: LayoutTreeActionType.CommitPendingAction;
}

/**
 * Action for clearing the pendingAction field from the layout tree state.
 */
export interface LayoutTreeClearPendingAction extends LayoutTreeAction {
    type: LayoutTreeActionType.ClearPendingAction;
}

/**
 * An operation to resize a node.
 */
export interface ResizeNodeOperation {
    /**
     * The id of the node to resize.
     */
    nodeId: string;
    /**
     * The new size for the node.
     */
    size: number;
}

/**
 * Action for resizing a node from the layout tree.
 */
export interface LayoutTreeResizeNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.ResizeNode;

    /**
     * A list of node ids to update and their respective new sizes.
     */
    resizeOperations: ResizeNodeOperation[];
}

/**
 * Action for toggling magnification of a node from the layout tree.
 */
export interface LayoutTreeMagnifyNodeToggleAction extends LayoutTreeAction {
    type: LayoutTreeActionType.MagnifyNodeToggle;

    /**
     * The id of the node to maximize;
     */
    nodeId: string;
}

/**
 * Represents a single node in the layout tree.
 */
export interface LayoutNode {
    id: string;
    data?: TabLayoutData;
    children?: LayoutNode[];
    flexDirection: FlexDirection;
    size: number;
}

export type LayoutTreeStateSetter = (value: LayoutState) => void;

export type LayoutTreeState = {
    rootNode: LayoutNode;
    magnifiedNodeId?: string;
    generation: number;
};

export type WritableLayoutTreeStateAtom = WritableAtom<LayoutTreeState, [value: LayoutTreeState], void>;

export type ContentRenderer = (
    data: TabLayoutData,
    ready: boolean,
    isMagnified: boolean,
    disablePointerEvents: boolean,
    onMagnifyToggle: () => void,
    onClose: () => void,
    dragHandleRef: React.RefObject<HTMLDivElement>
) => React.ReactNode;

export type PreviewRenderer = (data: TabLayoutData) => React.ReactElement;

export const DefaultNodeSize = 10;

/**
 * contains callbacks and information about the contents (or styling) of of the TileLayout
 * nothing in here is specific to the TileLayout itself
 */
export interface TileLayoutContents {
    /**
     * A callback that accepts the data from the leaf node and displays the leaf contents to the user.
     */
    renderContent: ContentRenderer;
    /**
     * A callback that accepts the data from the leaf node and returns a preview that can be shown when the user drags a node.
     */
    renderPreview?: PreviewRenderer;
    /**
     * A callback that is called when a node gets deleted from the LayoutTreeState.
     * @param data The contents of the node that was deleted.
     */
    onNodeDelete?: (data: TabLayoutData) => Promise<void>;
    /**
     * The class name to use for the top-level div of the tile layout.
     */
    className?: string;

    /**
     * A callback for getting the cursor point in reference to the current window. This removes Electron as a runtime dependency, allowing for better integration with Storybook.
     * @returns The cursor position relative to the current window.
     */
    getCursorPoint?: () => Point;

    /**
     * tabId this TileLayout is associated with
     */
    tabId?: string;
}

export interface ResizeHandleProps {
    id: string;
    parentNodeId: string;
    parentIndex: number;
    centerPx: number;
    transform: CSSProperties;
    flexDirection: FlexDirection;
}

export interface LayoutNodeAdditionalProps {
    transform?: CSSProperties;
    rect?: Dimensions;
    pixelToSizeRatio?: number;
    resizeHandles?: ResizeHandleProps[];
}
