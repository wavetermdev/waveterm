// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WritableAtom } from "jotai";
import { DropDirection, FlexDirection } from "./utils.js";

/**
 * Represents an operation to insert a node into a tree.
 */
export type MoveOperation<T> = {
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
    node: LayoutNode<T>;
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
 * @template T The type of data associated with the nodes of the tree.
 * @see MoveOperation
 * @see LayoutTreeMoveNodeAction
 */
export interface LayoutTreeComputeMoveNodeAction<T> extends LayoutTreeAction {
    type: LayoutTreeActionType.ComputeMove;
    node: LayoutNode<T>;
    nodeToMove: LayoutNode<T>;
    direction: DropDirection;
}

/**
 * Action for moving a node within the layout tree.
 *
 * @template T The type of data associated with the nodes of the tree.
 * @see MoveOperation
 */
export interface LayoutTreeMoveNodeAction<T> extends LayoutTreeAction, MoveOperation<T> {
    type: LayoutTreeActionType.Move;
}

/**
 * Action for swapping two nodes within the layout tree.
 *
 * @template T The type of data associated with the nodes of the tree.
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
 * @template T The type of data associated with the nodes of the tree.
 */
export interface LayoutTreeInsertNodeAction<T> extends LayoutTreeAction {
    type: LayoutTreeActionType.InsertNode;
    node: LayoutNode<T>;
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
 * Represents the state of a layout tree.
 *
 * @template T The type of data associated with the nodes of the tree.
 */
export type LayoutTreeState<T> = {
    rootNode: LayoutNode<T>;
    leafs: LayoutNode<T>[];
    pendingAction: LayoutTreeAction;
    generation: number;
    magnifiedNodeId?: string;
};

/**
 * Represents a single node in the layout tree.
 * @template T The type of data associated with the node.
 */
export interface LayoutNode<T> {
    id: string;
    data?: T;
    children?: LayoutNode<T>[];
    flexDirection: FlexDirection;
    size: number;
}

/**
 * An abstraction of the type definition for a writable layout node atom.
 */
export type WritableLayoutNodeAtom<T> = WritableAtom<LayoutNode<T>, [value: LayoutNode<T>], void>;

/**
 * An abstraction of the type definition for a writable layout tree state atom.
 */
export type WritableLayoutTreeStateAtom<T> = WritableAtom<LayoutTreeState<T>, [value: LayoutTreeState<T>], void>;

export type ContentRenderer<T> = (
    data: T,
    ready: boolean,
    onMagnifyToggle: () => void,
    onClose: () => void,
    dragHandleRef: React.RefObject<HTMLDivElement>
) => React.ReactNode;

export type PreviewRenderer<T> = (data: T) => React.ReactElement;

export interface LayoutNodeWaveObj<T> extends WaveObj {
    node: LayoutNode<T>;
    magnifiednodeid: string;
}

export const DefaultNodeSize = 10;
