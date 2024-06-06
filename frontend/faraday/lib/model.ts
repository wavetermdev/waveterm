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
    ComputeMove = "computeMove",
    Move = "move",
    CommitPendingAction = "commit",
    ResizeNode = "resize",
    InsertNode = "insert",
    DeleteNode = "delete",
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
 * Action for committing a pending action to the layout tree.
 */
export interface LayoutTreeCommitPendingAction extends LayoutTreeAction {
    type: LayoutTreeActionType.CommitPendingAction;
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
 * Represents the state of a layout tree.
 *
 * @template T The type of data associated with the nodes of the tree.
 */
export type LayoutTreeState<T> = {
    rootNode: LayoutNode<T>;
    leafs: LayoutNode<T>[];
    pendingAction: LayoutTreeAction;
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
    size?: number;
}

/**
 * An abstraction of the type definition for a writable layout node atom.
 */
export type WritableLayoutNodeAtom<T> = WritableAtom<LayoutNode<T>, [value: LayoutNode<T>], void>;

/**
 * An abstraction of the type definition for a writable layout tree state atom.
 */
export type WritableLayoutTreeStateAtom<T> = WritableAtom<LayoutTreeState<T>, [value: LayoutTreeState<T>], void>;

export type ContentRenderer<T> = (data: T, ready: boolean, onClose?: () => void) => React.ReactNode;

export interface LayoutNodeWaveObj<T> extends WaveObj {
    node: LayoutNode<T>;
}
