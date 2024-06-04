// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { newLayoutNode } from "../lib/layoutNode.js";
import { layoutTreeStateReducer, newLayoutTreeState } from "../lib/layoutState.js";
import { LayoutTreeActionType, LayoutTreeComputeMoveNodeAction, LayoutTreeMoveNodeAction } from "../lib/model.js";
import { DropDirection, FlexDirection } from "../lib/utils.js";
import { TestData } from "./model.js";

test("layoutTreeStateReducer - compute move", () => {
    let treeState = newLayoutTreeState<TestData>(
        newLayoutNode(FlexDirection.Row, undefined, undefined, { name: "root" })
    );
    assert(treeState.rootNode.data!.name === "root", "root should have no children and should have data");
    let node1 = newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "node1" });
    treeState = layoutTreeStateReducer(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        node: treeState.rootNode,
        nodeToMove: node1,
        direction: DropDirection.Bottom,
    } as LayoutTreeComputeMoveNodeAction<TestData>);
    const insertOperation = treeState.pendingAction as LayoutTreeMoveNodeAction<TestData>;
    assert(insertOperation.node === node1, "insert operation node should equal node1");
    assert(!insertOperation.parentId, "insert operation parent should not be defined");
    assert(insertOperation.index === 1, "insert operation index should equal 1");
    assert(insertOperation.insertAtRoot, "insert operation insertAtRoot should be true");
    treeState = layoutTreeStateReducer(treeState, {
        type: LayoutTreeActionType.CommitPendingAction,
    });
    assert(
        treeState.rootNode.data === undefined && treeState.rootNode.children!.length === 2,
        "root node should now have no data and should have two children"
    );
    assert(treeState.rootNode.children![1].data!.name === "node1", "root's second child should be node1");

    let node2 = newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "node2" });
    treeState = layoutTreeStateReducer(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        node: node1,
        nodeToMove: node2,
        direction: DropDirection.Bottom,
    } as LayoutTreeComputeMoveNodeAction<TestData>);
    const insertOperation2 = treeState.pendingAction as LayoutTreeMoveNodeAction<TestData>;
    assert(insertOperation2.node === node2, "insert operation node should equal node2");
    assert(insertOperation2.parentId === node1.id, "insert operation parent id should be node1 id");
    assert(insertOperation2.index === 1, "insert operation index should equal 1");
    assert(!insertOperation2.insertAtRoot, "insert operation insertAtRoot should be false");
    treeState = layoutTreeStateReducer(treeState, {
        type: LayoutTreeActionType.CommitPendingAction,
    });
    assert(
        treeState.rootNode.data === undefined && treeState.rootNode.children!.length === 2,
        "root node should still have three children"
    );
    assert(treeState.rootNode.children![1].children!.length === 2, "root's second child should now have two children");
});
