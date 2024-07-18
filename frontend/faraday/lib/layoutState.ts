// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazy } from "@/util/util";
import {
    addChildAt,
    addIntermediateNode,
    balanceNode,
    findNextInsertLocation,
    findNode,
    findParent,
    removeChild,
} from "./layoutNode";
import {
    DefaultNodeSize,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    MoveOperation,
} from "./model";
import { DropDirection, FlexDirection } from "./utils";

/**
 * Initializes a layout tree state.
 * @param rootNode The root node for the tree.
 * @returns The state of the tree.
 *t
 * @template T The type of data associated with the nodes of the tree.
 */
export function newLayoutTreeState<T>(rootNode: LayoutNode<T>): LayoutTreeState<T> {
    const { node: balancedRootNode, leafs } = balanceNode(rootNode);
    return {
        rootNode: balancedRootNode,
        leafs,
        pendingAction: undefined,
        generation: 0,
    };
}

/**
 * Performs a specified action on the layout tree state. Uses Immer Produce internally to resolve deep changes to the tree.
 *
 * @param layoutTreeState The state of the tree.
 * @param action The action to perform.
 *
 * @template T The type of data associated with the nodes of the tree.
 * @returns The new state of the tree.
 */
export function layoutTreeStateReducer<T>(
    layoutTreeState: LayoutTreeState<T>,
    action: LayoutTreeAction
): LayoutTreeState<T> {
    layoutTreeStateReducerInner(layoutTreeState, action);
    return layoutTreeState;
}

/**
 * Helper function for layoutTreeStateReducer.
 * @param layoutTreeState The state of the tree.
 * @param action The action to perform.
 * @see layoutTreeStateReducer
 * @template T The type of data associated with the nodes of the tree.
 */
function layoutTreeStateReducerInner<T>(layoutTreeState: LayoutTreeState<T>, action: LayoutTreeAction) {
    switch (action.type) {
        case LayoutTreeActionType.ComputeMove:
            computeMoveNode(layoutTreeState, action as LayoutTreeComputeMoveNodeAction<T>);
            break;
        case LayoutTreeActionType.SetPendingAction:
            setPendingAction(layoutTreeState, action as LayoutTreeSetPendingAction);
            break;
        case LayoutTreeActionType.ClearPendingAction:
            layoutTreeState.pendingAction = undefined;
            break;
        case LayoutTreeActionType.CommitPendingAction:
            if (!layoutTreeState?.pendingAction) {
                console.error("unable to commit pending action, does not exist");
                break;
            }
            layoutTreeStateReducerInner(layoutTreeState, layoutTreeState.pendingAction);
            layoutTreeState.pendingAction = undefined;
            break;
        case LayoutTreeActionType.Move:
            moveNode(layoutTreeState, action as LayoutTreeMoveNodeAction<T>);
            layoutTreeState.generation++;
            break;
        case LayoutTreeActionType.InsertNode:
            insertNode(layoutTreeState, action as LayoutTreeInsertNodeAction<T>);
            layoutTreeState.generation++;
            break;
        case LayoutTreeActionType.DeleteNode:
            deleteNode(layoutTreeState, action as LayoutTreeDeleteNodeAction);
            layoutTreeState.generation++;
            break;
        case LayoutTreeActionType.Swap:
            swapNode(layoutTreeState, action as LayoutTreeSwapNodeAction);
            layoutTreeState.generation++;
            break;
        case LayoutTreeActionType.ResizeNode:
            resizeNode(layoutTreeState, action as LayoutTreeResizeNodeAction);
            layoutTreeState.generation++;
            break;
        default: {
            console.error("Invalid reducer action", layoutTreeState, action);
        }
    }
}

/**
 * Computes an operation for inserting a new node into the tree in the given direction relative to the specified node.
 *
 * @param layoutTreeState The state of the tree.
 * @param computeInsertAction The operation to compute.
 *
 * @template T The type of data associated with the nodes of the tree.
 */
function computeMoveNode<T>(
    layoutTreeState: LayoutTreeState<T>,
    computeInsertAction: LayoutTreeComputeMoveNodeAction<T>
) {
    const rootNode = layoutTreeState.rootNode;
    const { node, nodeToMove, direction } = computeInsertAction;
    // console.log("computeInsertOperation start", layoutTreeState.rootNode, node, nodeToMove, direction);
    if (direction === undefined) {
        console.warn("No direction provided for insertItemInDirection");
        return;
    }

    if (node.id === nodeToMove.id) {
        console.warn("Cannot compute move node action since both nodes are equal");
        return;
    }

    let newMoveOperation: MoveOperation<T>;
    const parent = lazy(() => findParent(rootNode, node.id));
    const grandparent = lazy(() => findParent(rootNode, parent().id));
    const indexInParent = lazy(() => parent()?.children.findIndex((child) => node.id === child.id));
    const indexInGrandparent = lazy(() => grandparent()?.children.findIndex((child) => parent().id === child.id));
    const nodeToMoveParent = lazy(() => findParent(rootNode, nodeToMove.id));
    const nodeToMoveIndexInParent = lazy(() =>
        nodeToMoveParent()?.children.findIndex((child) => nodeToMove.id === child.id)
    );
    const isRoot = rootNode.id === node.id;

    switch (direction) {
        case DropDirection.OuterTop:
            if (node.flexDirection === FlexDirection.Column) {
                const grandparentNode = grandparent();
                if (grandparentNode) {
                    const index = indexInGrandparent();
                    newMoveOperation = {
                        parentId: grandparentNode.id,
                        node: nodeToMove,
                        index,
                    };
                    break;
                }
            }
        case DropDirection.Top:
            if (node.flexDirection === FlexDirection.Column) {
                newMoveOperation = { parentId: node.id, index: 0, node: nodeToMove };
            } else {
                if (isRoot)
                    newMoveOperation = {
                        node: nodeToMove,
                        index: 0,
                        insertAtRoot: true,
                    };

                const parentNode = parent();
                if (parentNode)
                    newMoveOperation = {
                        parentId: parentNode.id,
                        index: indexInParent() ?? 0,
                        node: nodeToMove,
                    };
            }
            break;
        case DropDirection.OuterBottom:
            if (node.flexDirection === FlexDirection.Column) {
                const grandparentNode = grandparent();
                if (grandparentNode) {
                    const index = indexInGrandparent() + 1;
                    newMoveOperation = {
                        parentId: grandparentNode.id,
                        node: nodeToMove,
                        index,
                    };
                    break;
                }
            }
        case DropDirection.Bottom:
            if (node.flexDirection === FlexDirection.Column) {
                newMoveOperation = { parentId: node.id, index: 1, node: nodeToMove };
            } else {
                if (isRoot)
                    newMoveOperation = {
                        node: nodeToMove,
                        index: 1,
                        insertAtRoot: true,
                    };

                const parentNode = parent();
                if (parentNode)
                    newMoveOperation = {
                        parentId: parentNode.id,
                        index: indexInParent() + 1,
                        node: nodeToMove,
                    };
            }
            break;
        case DropDirection.OuterLeft:
            if (node.flexDirection === FlexDirection.Row) {
                const grandparentNode = grandparent();
                if (grandparentNode) {
                    const index = indexInGrandparent();
                    newMoveOperation = {
                        parentId: grandparentNode.id,
                        node: nodeToMove,
                        index,
                    };
                    break;
                }
            }
        case DropDirection.Left:
            if (node.flexDirection === FlexDirection.Row) {
                newMoveOperation = { parentId: node.id, index: 0, node: nodeToMove };
            } else {
                const parentNode = parent();
                if (parentNode)
                    newMoveOperation = {
                        parentId: parentNode.id,
                        index: indexInParent(),
                        node: nodeToMove,
                    };
            }
            break;
        case DropDirection.OuterRight:
            if (node.flexDirection === FlexDirection.Row) {
                const grandparentNode = grandparent();
                if (grandparentNode) {
                    const index = indexInGrandparent() + 1;
                    newMoveOperation = {
                        parentId: grandparentNode.id,
                        node: nodeToMove,
                        index,
                    };
                    break;
                }
            }
        case DropDirection.Right:
            if (node.flexDirection === FlexDirection.Row) {
                newMoveOperation = { parentId: node.id, index: 1, node: nodeToMove };
            } else {
                const parentNode = parent();
                if (parentNode)
                    newMoveOperation = {
                        parentId: parentNode.id,
                        index: indexInParent() + 1,
                        node: nodeToMove,
                    };
            }
            break;
        case DropDirection.Center:
            // console.log("center drop", rootNode, node, nodeToMove);
            if (node.id !== rootNode.id && nodeToMove.id !== rootNode.id) {
                const swapAction: LayoutTreeSwapNodeAction = {
                    type: LayoutTreeActionType.Swap,
                    node1Id: node.id,
                    node2Id: nodeToMove.id,
                };
                // console.log("swapAction", swapAction);
                layoutTreeState.pendingAction = swapAction;
                return;
            } else {
                console.warn("cannot swap");
            }
            break;
        default:
            throw new Error(`Invalid direction: ${direction}`);
    }

    if (
        newMoveOperation?.parentId !== nodeToMoveParent()?.id ||
        (newMoveOperation.index !== nodeToMoveIndexInParent() &&
            newMoveOperation.index !== nodeToMoveIndexInParent() + 1)
    )
        layoutTreeState.pendingAction = {
            type: LayoutTreeActionType.Move,
            ...newMoveOperation,
        } as LayoutTreeMoveNodeAction<T>;
}

function setPendingAction(layoutTreeState: LayoutTreeState<any>, action: LayoutTreeSetPendingAction) {
    if (action.action === undefined) {
        console.error("setPendingAction: invalid pending action passed to function");
        return;
    }
    layoutTreeState.pendingAction = action.action;
}

function moveNode<T>(layoutTreeState: LayoutTreeState<T>, action: LayoutTreeMoveNodeAction<T>) {
    const rootNode = layoutTreeState.rootNode;
    // console.log("moveNode", action, layoutTreeState.rootNode);
    if (!action) {
        console.error("no move node action provided");
        return;
    }
    if (action.parentId && action.insertAtRoot) {
        console.error("parent and insertAtRoot cannot both be defined in a move node action");
        return;
    }

    const node = findNode(rootNode, action.node.id) ?? action.node;
    const parent = findNode(rootNode, action.parentId);
    const oldParent = findParent(rootNode, action.node.id);

    console.log(node, parent, oldParent);

    let startingIndex = 0;

    // If moving under the same parent, we need to make sure that we are removing the child from its old position, not its new one.
    // If the new index is before the old index, we need to start our search for the node to delete after the new index position.
    // If a node is being moved under the same parent, it can keep its size. Otherwise, it should get reset.
    if (oldParent && parent) {
        if (oldParent.id === parent.id) {
            const curIndexInParent = parent.children!.indexOf(node);
            if (curIndexInParent >= action.index) {
                startingIndex = action.index + 1;
            }
        } else {
            node.size = DefaultNodeSize;
        }
    }

    if (!parent && action.insertAtRoot) {
        if (!rootNode.children) {
            addIntermediateNode(rootNode);
        }
        addChildAt(rootNode, action.index, node);
    } else if (parent) {
        addChildAt(parent, action.index, node);
    } else {
        throw new Error("Invalid InsertOperation");
    }

    // Remove nodeToInsert from its old parent
    if (oldParent) {
        removeChild(oldParent, node, startingIndex);
    }

    const { node: newRootNode, leafs } = balanceNode(layoutTreeState.rootNode);
    layoutTreeState.rootNode = newRootNode;
    layoutTreeState.leafs = leafs;
    layoutTreeState.pendingAction = undefined;
}

function insertNode<T>(layoutTreeState: LayoutTreeState<T>, action: LayoutTreeInsertNodeAction<T>) {
    if (!action?.node) {
        console.error("no insert node action provided");
        return;
    }
    if (!layoutTreeState.rootNode) {
        const { node: balancedNode, leafs } = balanceNode(action.node);
        layoutTreeState.rootNode = balancedNode;
        layoutTreeState.leafs = leafs;
        return;
    }
    const insertLoc = findNextInsertLocation(layoutTreeState.rootNode, 5);
    addChildAt(insertLoc.node, insertLoc.index, action.node);
    const { node: newRootNode, leafs } = balanceNode(layoutTreeState.rootNode);
    layoutTreeState.rootNode = newRootNode;
    layoutTreeState.leafs = leafs;
}

function swapNode<T>(layoutTreeState: LayoutTreeState<T>, action: LayoutTreeSwapNodeAction) {
    console.log("swapNode", layoutTreeState, action);

    if (!action.node1Id || !action.node2Id) {
        console.error("invalid swapNode action, both node1 and node2 must be defined");
        return;
    }

    if (action.node1Id === layoutTreeState.rootNode.id || action.node2Id === layoutTreeState.rootNode.id) {
        console.error("invalid swapNode action, the root node cannot be swapped");
        return;
    }
    if (action.node1Id === action.node2Id) {
        console.error("invalid swapNode action, node1 and node2 are equal");
        return;
    }

    const parentNode1 = findParent(layoutTreeState.rootNode, action.node1Id);
    const parentNode2 = findParent(layoutTreeState.rootNode, action.node2Id);
    const parentNode1Index = parentNode1.children!.findIndex((child) => child.id === action.node1Id);
    const parentNode2Index = parentNode2.children!.findIndex((child) => child.id === action.node2Id);

    const node1 = parentNode1.children![parentNode1Index];
    const node2 = parentNode2.children![parentNode2Index];

    const node1Size = node1.size;
    node1.size = node2.size;
    node2.size = node1Size;

    parentNode1.children[parentNode1Index] = node2;
    parentNode2.children[parentNode2Index] = node1;

    const { node: newRootNode, leafs } = balanceNode(layoutTreeState.rootNode);
    layoutTreeState.rootNode = newRootNode;
    layoutTreeState.leafs = leafs;
}

function deleteNode<T>(layoutTreeState: LayoutTreeState<T>, action: LayoutTreeDeleteNodeAction) {
    // console.log("deleteNode", layoutTreeState, action);
    if (!action?.nodeId) {
        console.error("no delete node action provided");
        return;
    }
    if (!layoutTreeState.rootNode) {
        console.error("no root node");
        return;
    }
    if (layoutTreeState.rootNode.id === action.nodeId) {
        layoutTreeState.rootNode = undefined;
        layoutTreeState.leafs = undefined;
        return;
    }
    const parent = findParent(layoutTreeState.rootNode, action.nodeId);
    if (parent) {
        const node = parent.children.find((child) => child.id === action.nodeId);
        removeChild(parent, node);
        // console.log("node deleted", parent, node);
    } else {
        console.error("unable to delete node, not found in tree");
    }
    const { node: newRootNode, leafs } = balanceNode(layoutTreeState.rootNode);
    layoutTreeState.rootNode = newRootNode;
    layoutTreeState.leafs = leafs;
}

function resizeNode<T>(layoutTreeState: LayoutTreeState<T>, action: LayoutTreeResizeNodeAction) {
    console.log("resizeNode", layoutTreeState, action);
    if (!action.resizeOperations) {
        console.error("invalid resizeNode operation. nodeSizes array must be defined.");
    }
    for (const resize of action.resizeOperations) {
        if (!resize.nodeId || resize.size < 0 || resize.size > 100) {
            console.error("invalid resizeNode operation. nodeId must be defined and size must be between 0 and 100");
            return;
        }
        const node = findNode(layoutTreeState.rootNode, resize.nodeId);
        node.size = resize.size;
    }
}
