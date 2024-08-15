// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazy } from "@/util/util";
import {
    addChildAt,
    addIntermediateNode,
    balanceNode,
    findInsertLocationFromIndexArr,
    findNextInsertLocation,
    findNode,
    findParent,
    removeChild,
} from "./layoutNode";
import {
    DefaultNodeSize,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    MoveOperation,
} from "./types";
import { DropDirection, FlexDirection } from "./utils";

/**
 * Performs a specified action on the layout tree state. Uses Immer Produce internally to resolve deep changes to the tree.
 *
 * @param layoutState The state of the tree.
 * @param action The action to perform.
 *
 * @returns The new state of the tree.
 */
export function layoutStateReducer(layoutState: LayoutTreeState, action: LayoutTreeAction): LayoutTreeState {
    layoutStateReducerInner(layoutState, action);
    return layoutState;
}

/**
 * Helper function for layoutStateReducer.
 * @param layoutState The state of the tree.
 * @param action The action to perform.
 * @see layoutStateReducer
 */
function layoutStateReducerInner(layoutState: LayoutTreeState, action: LayoutTreeAction) {
    switch (action.type) {
        case LayoutTreeActionType.ComputeMove:
            computeMoveNode(layoutState, action as LayoutTreeComputeMoveNodeAction);
            break;
        case LayoutTreeActionType.Move:
            moveNode(layoutState, action as LayoutTreeMoveNodeAction);
            break;
        case LayoutTreeActionType.InsertNode:
            insertNode(layoutState, action as LayoutTreeInsertNodeAction);
            break;
        case LayoutTreeActionType.InsertNodeAtIndex:
            insertNodeAtIndex(layoutState, action as LayoutTreeInsertNodeAtIndexAction);
            break;
        case LayoutTreeActionType.DeleteNode:
            deleteNode(layoutState, action as LayoutTreeDeleteNodeAction);
            break;
        case LayoutTreeActionType.Swap:
            swapNode(layoutState, action as LayoutTreeSwapNodeAction);
            break;
        case LayoutTreeActionType.ResizeNode:
            resizeNode(layoutState, action as LayoutTreeResizeNodeAction);
            break;
        case LayoutTreeActionType.MagnifyNodeToggle:
            magnifyNodeToggle(layoutState, action as LayoutTreeMagnifyNodeToggleAction);
            break;
        default: {
            console.error("Invalid reducer action", layoutState, action);
        }
    }
}

/**
 * Computes an operation for inserting a new node into the tree in the given direction relative to the specified node.
 *
 * @param layoutState The state of the tree.
 * @param computeInsertAction The operation to compute.
 */
export function computeMoveNode(layoutState: LayoutTreeState, computeInsertAction: LayoutTreeComputeMoveNodeAction) {
    const rootNode = layoutState.rootNode;
    const { node, nodeToMove, direction } = computeInsertAction;
    // console.log("computeInsertOperation start", layoutState.rootNode, node, nodeToMove, direction);
    if (direction === undefined) {
        console.warn("No direction provided for insertItemInDirection");
        return;
    }

    if (node.id === nodeToMove.id) {
        console.warn("Cannot compute move node action since both nodes are equal");
        return;
    }

    let newMoveOperation: MoveOperation;
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
                return swapAction;
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
        return {
            type: LayoutTreeActionType.Move,
            ...newMoveOperation,
        } as LayoutTreeMoveNodeAction;
}

export function moveNode(layoutState: LayoutTreeState, action: LayoutTreeMoveNodeAction) {
    const rootNode = layoutState.rootNode;
    // console.log("moveNode", action, layoutState.rootNode);
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

    layoutState.rootNode = balanceNode(layoutState.rootNode);
}

export function insertNode(layoutState: LayoutTreeState, action: LayoutTreeInsertNodeAction) {
    if (!action?.node) {
        console.error("insertNode cannot run, no insert node action provided");
        return;
    }
    if (!layoutState.rootNode) {
        layoutState.rootNode = balanceNode(action.node);
        return;
    }
    const insertLoc = findNextInsertLocation(layoutState.rootNode, 5);
    addChildAt(insertLoc.node, insertLoc.index, action.node);
    layoutState.rootNode = balanceNode(layoutState.rootNode);
}

export function insertNodeAtIndex(layoutState: LayoutTreeState, action: LayoutTreeInsertNodeAtIndexAction) {
    if (!action?.node || !action?.indexArr) {
        console.error("insertNodeAtIndex cannot run, either node or indexArr field is missing");
        return;
    }
    if (!layoutState.rootNode) {
        layoutState.rootNode = balanceNode(action.node);
        return;
    }
    const insertLoc = findInsertLocationFromIndexArr(layoutState.rootNode, action.indexArr);
    if (!insertLoc) {
        console.error("insertNodeAtIndex unable to find insert location");
        return;
    }
    addChildAt(insertLoc.node, insertLoc.index + 1, action.node);
    layoutState.rootNode = balanceNode(layoutState.rootNode);
}

export function swapNode(layoutState: LayoutTreeState, action: LayoutTreeSwapNodeAction) {
    console.log("swapNode", layoutState, action);

    if (!action.node1Id || !action.node2Id) {
        console.error("invalid swapNode action, both node1 and node2 must be defined");
        return;
    }

    if (action.node1Id === layoutState.rootNode.id || action.node2Id === layoutState.rootNode.id) {
        console.error("invalid swapNode action, the root node cannot be swapped");
        return;
    }
    if (action.node1Id === action.node2Id) {
        console.error("invalid swapNode action, node1 and node2 are equal");
        return;
    }

    const parentNode1 = findParent(layoutState.rootNode, action.node1Id);
    const parentNode2 = findParent(layoutState.rootNode, action.node2Id);
    const parentNode1Index = parentNode1.children!.findIndex((child) => child.id === action.node1Id);
    const parentNode2Index = parentNode2.children!.findIndex((child) => child.id === action.node2Id);

    const node1 = parentNode1.children![parentNode1Index];
    const node2 = parentNode2.children![parentNode2Index];

    const node1Size = node1.size;
    node1.size = node2.size;
    node2.size = node1Size;

    parentNode1.children[parentNode1Index] = node2;
    parentNode2.children[parentNode2Index] = node1;

    layoutState.rootNode = balanceNode(layoutState.rootNode);
}

export function deleteNode(layoutState: LayoutTreeState, action: LayoutTreeDeleteNodeAction) {
    // console.log("deleteNode", layoutState, action);
    if (!action?.nodeId) {
        console.error("no delete node action provided");
        return;
    }
    if (!layoutState.rootNode) {
        console.error("no root node");
        return;
    }
    if (layoutState.rootNode.id === action.nodeId) {
        layoutState.rootNode = undefined;
        return;
    }
    const parent = findParent(layoutState.rootNode, action.nodeId);
    if (parent) {
        const node = parent.children.find((child) => child.id === action.nodeId);
        removeChild(parent, node);
        // console.log("node deleted", parent, node);
    } else {
        console.error("unable to delete node, not found in tree");
    }
    layoutState.rootNode = balanceNode(layoutState.rootNode);
}

export function resizeNode(layoutState: LayoutTreeState, action: LayoutTreeResizeNodeAction) {
    console.log("resizeNode", layoutState, action);
    if (!action.resizeOperations) {
        console.error("invalid resizeNode operation. nodeSizes array must be defined.");
    }
    for (const resize of action.resizeOperations) {
        if (!resize.nodeId || resize.size < 0 || resize.size > 100) {
            console.error("invalid resizeNode operation. nodeId must be defined and size must be between 0 and 100");
            return;
        }
        const node = findNode(layoutState.rootNode, resize.nodeId);
        node.size = resize.size;
    }
}

export function magnifyNodeToggle(layoutState: LayoutTreeState, action: LayoutTreeMagnifyNodeToggleAction) {
    console.log("magnifyNodeToggle", layoutState, action);
    if (!action.nodeId) {
        console.error("invalid magnifyNodeToggle operation. nodeId must be defined.");
        return;
    }
    if (layoutState.rootNode.id === action.nodeId) {
        console.warn(`cannot toggle magnification of node ${action.nodeId} because it is the root node.`);
        return;
    }
    if (layoutState.magnifiedNodeId === action.nodeId) {
        layoutState.magnifiedNodeId = undefined;
    } else {
        layoutState.magnifiedNodeId = action.nodeId;
    }
}
