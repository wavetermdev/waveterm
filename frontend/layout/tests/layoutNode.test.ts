// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { addChildAt, addIntermediateNode, balanceNode, findNextInsertLocation, newLayoutNode } from "../lib/layoutNode";
import { FlexDirection, LayoutNode } from "../lib/types";

test("newLayoutNode", () => {

    const originalConsoleError = console.error
    console.error = () => { /* swallow expected validation errors in tests */ }

    assert.throws(
        () => newLayoutNode(FlexDirection.Column),
        "Invalid node",
        undefined,
        "calls to the constructor without data or children should fail"
    );
    assert.throws(
        () => newLayoutNode(FlexDirection.Column, undefined, [], { blockId: "hello" }),
        "Invalid node",
        undefined,
        "calls to the constructor with both data and children should fail"
    );
    assert.doesNotThrow(
        () => newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "hello" }),
        "Invalid node",
        undefined,
        "calls to the constructor with only data defined should succeed"
    );
    assert.throws(() => newLayoutNode(FlexDirection.Column, undefined, [], undefined)),
        "Invalid node",
        undefined,
        "calls to the constructor with empty children array should fail";
    assert.doesNotThrow(() =>
        newLayoutNode(
            FlexDirection.Column,
            undefined,
            [newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "hello" })],
            undefined
        )
    ),
        "Invalid node",
        undefined,
        "calls to the constructor with children array containing at least one child should succeed";
    console.error = originalConsoleError
});

test("addIntermediateNode", () => {
    let node1: LayoutNode = newLayoutNode(FlexDirection.Column, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "hello" }),
    ]);
    assert(node1.children![0].data!.blockId === "hello", "node1 should have one child which should have data");
    const intermediateNode1 = addIntermediateNode(node1);
    assert(
        node1.children !== undefined && node1.children.length === 1 && node1.children?.includes(intermediateNode1),
        "node1 should have a single child intermediateNode1"
    );
    assert(intermediateNode1.flexDirection === FlexDirection.Row, "intermediateNode1 should have flexDirection Row");
    assert(
        intermediateNode1.children![0].children![0].data!.blockId === "hello" &&
            intermediateNode1.children![0].children![0].flexDirection === FlexDirection.Row,
        "intermediateNode1 should have a nested child which should have data and flexDirection Row"
    );
    let node2: LayoutNode = newLayoutNode(FlexDirection.Column, undefined, undefined, {
        blockId: "hello",
    });
    const intermediateNode2 = addIntermediateNode(node2);
    assert(
        node2.children !== undefined &&
            node2.data === undefined &&
            node2.children.length === 1 &&
            node2.children.includes(intermediateNode2),
        "node2 should have no data and a single child intermediateNode2"
    );
    assert(
        intermediateNode2.data.blockId === "hello" && intermediateNode2.children === undefined,
        "intermediateNode2 should have no children and should have data matching the old value of node2"
    );
});

test("addChildAt - same flexDirection, no children", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" });
    let node2 = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node2" });
    addChildAt(node1, 1, node2);
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children!.length === 2, "node1 should have two children");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have node1's data");
    assert(node1.children![1].id === node2.id, "node1's second child should be node2");
    assert(node1.children![1].flexDirection === FlexDirection.Column, "node2 should now have flexDirection Column");
});

test("addChildAt - different flexDirection, no children", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" });
    let node2 = newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node2" });
    addChildAt(node1, 1, node2);
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children!.length === 2, "node1 should have two children");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have node1's data");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have flexDirection Column");
    assert(node1.children![1].id === node2.id, "node1's second child should be node2");
    assert(node1.children![1].flexDirection === FlexDirection.Column, "node2 should have flexDirection Row");
});

test("addChildAt - same flexDirection, first node has children, second doesn't", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node1" }),
    ]);
    let node2 = newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node2" });
    addChildAt(node1, 1, node2);
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children!.length === 2, "node1 should have two children");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have node1's data");
    assert(
        node1.children![0].flexDirection === FlexDirection.Column,
        "node1's first child should have flexDirection Column"
    );
    assert(node1.children![1].id === node2.id, "node1's second child should be node2");
    assert(node1.children![1].flexDirection === FlexDirection.Column, "node2 should have flexDirection Column");
});

test("addChildAt - different flexDirection, first node has children, second doesn't", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node1" }),
    ]);
    let node2 = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node2" });
    addChildAt(node1, 1, node2);
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children!.length === 2, "node1 should have two children");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have node1's data");
    assert(node1.children![1].id === node2.id, "node1's second child should be node2");
    assert(node1.children![1].flexDirection === FlexDirection.Column, "node2 should now have flexDirection Column");
});

test("addChildAt - same flexDirection, first node has children, second has children", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node1" }),
    ]);
    let node2 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node2" }),
    ]);
    addChildAt(node1, 1, node2);
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children!.length === 2, "node1 should have two children");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have node1's data");
    assert(
        node1.children![0].flexDirection === FlexDirection.Column,
        "node1's first child should have flexDirection Column"
    );
    assert(node1.children![1].id === node2.children![0].id, "node1's second child should be node2's child");
    assert(
        node1.children![1].flexDirection === FlexDirection.Column,
        "node1's second child should have flexDirection Column"
    );
});

test("addChildAt - different flexDirection, first node has children, second has children", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node1" }),
    ]);
    let node2 = newLayoutNode(FlexDirection.Column, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node2" }),
    ]);
    addChildAt(node1, 1, node2);
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children!.length === 2, "node1 should have two children");
    assert(node1.children![0].data!.blockId === "node1", "node1's first child should have node1's data");
    assert(
        node1.children![0].flexDirection === FlexDirection.Column,
        "node1's first child should have flexDirection Column"
    );
    assert(node1.children![1].id === node2.id, "node1's second child should be node2");
    assert(
        node1.children![1].flexDirection === FlexDirection.Column,
        "node1's second child should have flexDirection Column"
    );
});

test("balanceNode - corrects flex directions", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1Inner1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1Inner2" }),
    ]);
    const newNode1 = balanceNode(node1);
    assert(newNode1 !== undefined, "newNode1 should not be undefined");
    node1 = newNode1;
    assert(node1.data === undefined, "node1 should have no data");
    assert(node1.children![0].flexDirection !== node1.flexDirection);
});

test("balanceNode - collapses nodes with single grandchild 1", () => {
    let node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, [
            newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        ]),
    ]);
    const newNode1 = balanceNode(node1);
    assert(newNode1 !== undefined, "newNode1 should not be undefined");
    node1 = newNode1;
    assert(node1.children === undefined, "node1 should have no children");
    assert(node1.data!.blockId === "node1", "node1 should have data 'node1'");
});

test("balanceNode - collapses nodes with single grandchild 2", () => {
    let node2 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, [
            newLayoutNode(FlexDirection.Row, undefined, [
                newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node2Inner1" }),
                newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node2Inner2" }),
            ]),
        ]),
    ]);
    const newNode2 = balanceNode(node2);
    assert(newNode2 !== undefined, "newNode2 should not be undefined");
    node2 = newNode2;
    assert(node2.children!.length === 2, "node2 should have two children");
    assert(node2.children[0].data!.blockId === "node2Inner1", "node2's first child should have data 'node2Inner1'");
    // assert(leafs.length === 2, "leafs should have two leafs");
    // assert(leafs[0].data!.blockId === "node2Inner1", "leafs[0] should have data 'node2Inner1'");
    // assert(leafs[1].data!.blockId === "node2Inner2", "leafs[1] should have data 'node2Inner2'");
});

test("balanceNode - collapses nodes with single grandchild 3", () => {
    let node3 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, [
            newLayoutNode(FlexDirection.Row, undefined, [
                newLayoutNode(FlexDirection.Column, undefined, undefined, { blockId: "node3" }),
            ]),
        ]),
    ]);
    const newNode3 = balanceNode(node3);
    assert(newNode3 !== undefined, "newNode3 should not be undefined");
    node3 = newNode3;
    assert(node3.children === undefined, "node3 should have no children");
    assert(node3.data!.blockId === "node3", "node3 should have data 'node3'");
});

test("balanceNode - collapses nodes with single grandchild 4", () => {
    let node4 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, [
            newLayoutNode(FlexDirection.Row, undefined, [
                newLayoutNode(FlexDirection.Column, undefined, [
                    newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node4Inner1" }),
                    newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node4Inner2" }),
                ]),
            ]),
        ]),
    ]);
    const newNode4 = balanceNode(node4);
    assert(newNode4 !== undefined, "newNode4 should not be undefined");
    node4 = newNode4;
    assert(node4.children!.length === 1, "node4 should have one child");
    assert(node4.children![0].children!.length === 2, "node4 should have two grandchildren");
    assert(
        node4.children[0].children![0].data!.blockId === "node4Inner1",
        "node4's first child should have data 'node4Inner1'"
    );
});

test("findNextInsertLocation", () => {
    const node1 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
    ]);

    const insertLoc1 = findNextInsertLocation(node1, 5);
    assert(insertLoc1.node.id === node1.id, "should insert into node1");
    assert(insertLoc1.index === 4, "should insert into index 4 of node1");

    const node2Inner5 = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node2Inner5" });
    const node2 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        node2Inner5,
    ]);

    const insertLoc2 = findNextInsertLocation(node2, 5);
    assert(insertLoc2.node.id === node2Inner5.id, "should insert into node2Inner5");
    assert(insertLoc2.index === 1, "should insert into index 1 of node2Inner1");

    const node3Inner5 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
    ]);
    const node3Inner4 = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node3Inner4" });
    const node3 = newLayoutNode(FlexDirection.Row, undefined, [
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "node1" }),
        node3Inner4,
        node3Inner5,
    ]);

    const insertLoc3 = findNextInsertLocation(node3, 5);
    assert(insertLoc3.node.id === node3Inner4.id, "should insert into node3Inner4");
    assert(insertLoc3.index === 1, "should insert into index 1 of node3Inner4");
});
