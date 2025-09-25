// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Atom, WritableAtom } from "jotai";
import { CSSProperties } from "react";

export enum NavigateDirection {
    Up = 0,
    Right = 1,
    Down = 2,
    Left = 3,
}

export enum DropDirection {
    Top = 0,
    Right = 1,
    Bottom = 2,
    Left = 3,
    OuterTop = 4,
    OuterRight = 5,
    OuterBottom = 6,
    OuterLeft = 7,
    Center = 8,
}

export enum FlexDirection {
    Row = "row",
    Column = "column",
}

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
    FocusNode = "focus",
    MagnifyNodeToggle = "magnify",
    ClearTree = "clear",
    ReplaceNode = "replace",
    SplitHorizontal = "splithorizontal",
    SplitVertical = "splitvertical",
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
    nodeId: string;
    nodeToMoveId: string;
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

interface InsertNodeOperation {
    /**
     * The node to insert.
     */
    node: LayoutNode;
    /**
     * Whether the inserted node should be magnified.
     */
    magnified: boolean;
    /**
     * Whether the inserted node should be focused.
     */
    focused: boolean;
}

/**
 * Action for inserting a new node to the layout tree.
 *
 */
export interface LayoutTreeInsertNodeAction extends LayoutTreeAction, InsertNodeOperation {
    type: LayoutTreeActionType.InsertNode;
}

/**
 * Action for inserting a node into the layout tree at the specified index.
 */
export interface LayoutTreeInsertNodeAtIndexAction extends LayoutTreeAction, InsertNodeOperation {
    type: LayoutTreeActionType.InsertNodeAtIndex;
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

// ReplaceNode: replace an existing node in place with a new one.
export interface LayoutTreeReplaceNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.ReplaceNode;
    targetNodeId: string;
    newNode: LayoutNode;
    focused?: boolean;
}

// SplitHorizontal: split the current block horizontally.
// The "position" field indicates whether the new node should be inserted before (to the left)
// or after (to the right) of the target node.
export interface LayoutTreeSplitHorizontalAction extends LayoutTreeAction {
    type: LayoutTreeActionType.SplitHorizontal;
    targetNodeId: string;
    newNode: LayoutNode;
    position: "before" | "after";
    focused?: boolean;
}

// SplitVertical: similar to split horizontal but along the vertical axis.
export interface LayoutTreeSplitVerticalAction extends LayoutTreeAction {
    type: LayoutTreeActionType.SplitVertical;
    targetNodeId: string;
    newNode: LayoutNode;
    position: "before" | "after";
    focused?: boolean;
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
 * Action for focusing a node from the layout tree.
 */
export interface LayoutTreeFocusNodeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.FocusNode;

    /**
     * The id of the node to focus;
     */
    nodeId: string;
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
 * Action for clearing all nodes from the layout tree.
 */
export interface LayoutTreeClearTreeAction extends LayoutTreeAction {
    type: LayoutTreeActionType.ClearTree;
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
    focusedNodeId?: string;
    magnifiedNodeId?: string;
    /**
     * A computed ordered list of leafs in the layout. This value is driven by the LayoutModel and should not be read when updated from the backend.
     */
    leafOrder?: LeafOrderEntry[];
    pendingBackendActions: LayoutActionData[];
    generation: number;
};

export type WritableLayoutTreeStateAtom = WritableAtom<LayoutTreeState, [value: LayoutTreeState], void>;

export type ContentRenderer = (nodeModel: NodeModel) => React.ReactNode;

export type PreviewRenderer = (nodeModel: NodeModel) => React.ReactElement;

export const DefaultNodeSize = 10;

/**
 * contains callbacks and information about the contents (or styling) of of the TileLayout
 * nothing in here is specific to the TileLayout itself
 */
export interface TileLayoutContents {
    /**
     * The tabId with which this TileLayout is associated.
     */
    tabId?: string;

    /**
     * The class name to use for the top-level div of the tile layout.
     */
    className?: string;

    /**
     * The gap between tiles in a layout, in CSS pixels.
     */
    gapSizePx?: number;

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
     * A callback for getting the cursor point in reference to the current window. This removes Electron as a runtime dependency, allowing for better integration with Storybook.
     * @returns The cursor position relative to the current window.
     */
    getCursorPoint?: () => Point;
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
    treeKey: string;
    transform?: CSSProperties;
    rect?: Dimensions;
    pixelToSizeRatio?: number;
    resizeHandles?: ResizeHandleProps[];
}

export interface NodeModel {
    additionalProps: Atom<LayoutNodeAdditionalProps>;
    innerRect: Atom<CSSProperties>;
    blockNum: Atom<number>;
    numLeafs: Atom<number>;
    nodeId: string;
    blockId: string;
    addEphemeralNodeToLayout: () => void;
    animationTimeS: Atom<number>;
    isResizing: Atom<boolean>;
    isFocused: Atom<boolean>;
    isMagnified: Atom<boolean>;
    isEphemeral: Atom<boolean>;
    ready: Atom<boolean>;
    disablePointerEvents: Atom<boolean>;
    toggleMagnify: () => void;
    focusNode: () => void;
    onClose: () => void;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
    displayContainerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Result object returned by switchNodeFocusInDirection method.
 */
export interface NavigationResult {
    success: boolean;
    atLeft?: boolean;
    atTop?: boolean;
    atBottom?: boolean;
    atRight?: boolean;
}
