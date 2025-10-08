// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { newLayoutNode } from "../lib/layoutNode";
import { computeMoveNode, moveNode } from "../lib/layoutTree";
import {
    DropDirection,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeMoveNodeAction,
} from "../lib/types";
import { newLayoutTreeState } from "./model";

test("layoutTreeStateReducer - compute move", () => {
    const node1 = newLayoutNode(undefined, undefined, undefined, { blockId: "node1" });
    const node2 = newLayoutNode(undefined, undefined, undefined, { blockId: "node2" });
    const node3 = newLayoutNode(undefined, undefined, undefined, { blockId: "node3" });
    const rootNode = newLayoutNode(undefined, undefined, [node1, node2, node3], undefined);
    const treeState = newLayoutTreeState(rootNode);

    // Move node2 ahead of node1.
    let pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: node1.id,
        nodeToMoveId: node2.id,
        direction: DropDirection.Top,
    });
    const moveOp = pendingAction as LayoutTreeMoveNodeAction;
    assert(moveOp, "computeMoveNode should return a move operation");
    assert(moveOp.parentId === treeState.rootNode.id, "move operation should target the root node");
    assert(moveOp.index === 0, "node2 should be inserted at the beginning");
    moveNode(treeState, moveOp);
    assert(treeState.rootNode.children![0].id === node2.id, "node2 should now be first child");
    assert(treeState.rootNode.children![1].id === node1.id, "node1 should now follow node2");

    // Move node2 to the end of the root list.
    pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: node3.id,
        nodeToMoveId: node2.id,
        direction: DropDirection.Bottom,
    });
    const moveOpBottom = pendingAction as LayoutTreeMoveNodeAction;
    assert(moveOpBottom, "computeMoveNode should produce a second move operation");
    assert(
        moveOpBottom.parentId === treeState.rootNode.id,
        "move operation should target the root parent when dropping below node3"
    );
    moveNode(treeState, moveOpBottom);
    const children = treeState.rootNode.children!;
    assert(children[0].id === node1.id, "node1 should become the first child after node2 moves away");
    assert(children[1].id === node3.id, "node3 should remain in the middle position");
    assert(children[2].id === node2.id, "node2 should be reinserted at the end after dropping below node3");
});

test("computeMove - noop action", () => {
    let nodeToMove = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeToMove" });
    let treeState = newLayoutTreeState(
        newLayoutNode(undefined, undefined, [
            nodeToMove,
            newLayoutNode(undefined, undefined, undefined, { blockId: "otherNode" }),
        ])
    );
    let moveAction: LayoutTreeComputeMoveNodeAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Left,
    };
    let pendingAction = computeMoveNode(treeState, moveAction);

    assert(pendingAction === undefined, "inserting a node to the left of itself should not produce a pendingAction");

    moveAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Right,
    };

    pendingAction = computeMoveNode(treeState, moveAction);
    assert(pendingAction === undefined, "inserting a node to the right of itself should not produce a pendingAction");
});
