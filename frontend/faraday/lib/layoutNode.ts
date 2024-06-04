// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { LayoutNode } from "./model.js";
import { FlexDirection, getCrypto, reverseFlexDirection } from "./utils.js";

const crypto = getCrypto();

/**
 * Creates a new node.
 * @param flexDirection The flex direction for the new node.
 * @param size The size for the new node.
 * @param children The children for the new node.
 * @param data The data for the new node.
 * @template T The type of data associated with the node.
 * @returns The new node.
 */
export function newLayoutNode<T>(
    flexDirection?: FlexDirection,
    size?: number,
    children?: LayoutNode<T>[],
    data?: T
): LayoutNode<T> {
    const newNode: LayoutNode<T> = {
        id: crypto.randomUUID(),
        flexDirection: flexDirection ?? FlexDirection.Column,
        size,
        children,
        data,
    };

    if (!validateNode(newNode)) {
        throw new Error("Invalid node");
    }
    return newNode;
}

/**
 * Adds new nodes to the tree at the given index.
 * @param node The parent node.
 * @param idx The index to insert at.
 * @param children The nodes to insert.
 * @template T The type of data associated with the node.
 * @returns The updated parent node.
 */
export function addChildAt<T>(node: LayoutNode<T>, idx: number, ...children: LayoutNode<T>[]) {
    console.log("adding", children, "to", node, "at index", idx);
    if (children.length === 0) return;

    if (!node.children) {
        addIntermediateNode(node);
    }
    const childrenToAdd = children.flatMap((v) => {
        if (v.flexDirection !== node.flexDirection) {
            return v;
        } else if (v.children) {
            return v.children;
        } else {
            v.flexDirection = reverseFlexDirection(node.flexDirection);
            return v;
        }
    });

    if (node.children.length <= idx) {
        node.children.push(...childrenToAdd);
    } else if (idx >= 0) {
        node.children.splice(idx, 0, ...childrenToAdd);
    }
}

/**
 * Adds an intermediate node as a direct child of the given node, moving the given node's children or data into it.
 *
 * If the node contains children, they are moved two levels deeper to preserve their flex direction. If the node only has data, it is moved one level deeper.
 * @param node The node to add the intermediate node to.
 * @template T The type of data associated with the node.
 * @returns The updated node and the node that was added.
 */
export function addIntermediateNode<T>(node: LayoutNode<T>): LayoutNode<T> {
    let intermediateNode: LayoutNode<T>;
    console.log(node);

    if (node.data) {
        intermediateNode = newLayoutNode(reverseFlexDirection(node.flexDirection), undefined, undefined, node.data);
        node.children = [intermediateNode];
        node.data = undefined;
    } else {
        const intermediateNodeInner = newLayoutNode(node.flexDirection, undefined, node.children);
        intermediateNode = newLayoutNode(reverseFlexDirection(node.flexDirection), undefined, [intermediateNodeInner]);
        node.children = [intermediateNode];
    }
    const intermediateNodeId = intermediateNode.id;
    intermediateNode.id = node.id;
    node.id = intermediateNodeId;
    return intermediateNode;
}

/**
 * Attempts to remove the specified node from its parent.
 * @param parent The parent node.
 * @param childToRemove The node to remove.
 * @template T The type of data associated with the node.
 * @returns The updated parent node, or undefined if the node was not found.
 */
export function removeChild<T>(parent: LayoutNode<T>, childToRemove: LayoutNode<T>) {
    if (!parent.children) return;
    const idx = parent.children.indexOf(childToRemove);
    if (idx === -1) return;
    parent.children?.splice(idx, 1);
}

/**
 * Finds the node with the given id.
 * @param node The node to search in.
 * @param id The id to search for.
 * @template T The type of data associated with the node.
 * @returns The node with the given id or undefined if no node with the given id was found.
 */
export function findNode<T>(node: LayoutNode<T>, id: string): LayoutNode<T> | undefined {
    if (node.id === id) return node;
    if (!node.children) return;
    for (const child of node.children) {
        const result = findNode(child, id);
        if (result) return result;
    }
    return;
}

/**
 * Finds the node whose children contains the node with the given id.
 * @param node The node to start the search from.
 * @param id The id to search for.
 * @template T The type of data associated with the node.
 * @returns The parent node, or undefined if no node with the given id was found.
 */
export function findParent<T>(node: LayoutNode<T>, id: string): LayoutNode<T> | undefined {
    if (node.id === id || !node.children) return;
    for (const child of node.children) {
        if (child.id === id) return node;
        const retVal = findParent(child, id);
        if (retVal) return retVal;
    }
    return;
}

/**
 * Determines whether a node is valid.
 * @param node The node to validate.
 * @template T The type of data associated with the node.
 * @returns True if the node is valid, false otherwise.
 */
export function validateNode<T>(node: LayoutNode<T>): boolean {
    if (!node.children == !node.data) {
        console.error("Either children or data must be defined for node, not both");
        return false;
    }

    if (node.children?.length === 0) {
        console.error("Node cannot define an empty array of children");
        return false;
    }
    return true;
}

/**
 * Recursively corrects the tree to minimize nested single-child nodes, remove invalid nodes, and correct invalid flex direction order.
 * Also finds all leaf nodes under the specified node.
 * @param node The node to start the balancing from.
 * @template T The type of data associated with the node.
 * @returns The corrected node and an array of leaf nodes.
 */
export function balanceNode<T>(node: LayoutNode<T>): { node: LayoutNode<T>; leafs: LayoutNode<T>[] } | undefined {
    const leafs: LayoutNode<T>[] = [];
    const newNode = balanceNodeHelper(node, leafs);
    return { node: newNode, leafs };
}

function balanceNodeHelper<T>(node: LayoutNode<T>, leafs: LayoutNode<T>[]): LayoutNode<T> {
    if (!node) return;
    if (!node.children) {
        leafs.push(node);
        return node;
    }
    if (node.children.length === 0) return;
    if (!validateNode(node)) throw new Error("Invalid node");
    node.children = node.children
        .flatMap((child) => {
            if (child.flexDirection === node.flexDirection) {
                child.flexDirection = reverseFlexDirection(node.flexDirection);
            }
            if (child.children?.length === 1 && child.children[0].children) {
                return child.children[0].children;
            }
            return child;
        })
        .map((child) => {
            return balanceNodeHelper(child, leafs);
        })
        .filter((v) => v);
    if (node.children.length === 1 && !node.children[0].children) {
        node.data = node.children[0].data;
        node.id = node.children[0].id;
        node.children = undefined;
    }
    return node;
}

/**
 * Finds the first node in the tree where a new node can be inserted.
 *
 * This will attempt to fill each node until it has maxChildren children. If a node is full, it will move to its children and
 * fill each of them until it has maxChildren children. It will ensure that each child fills evenly before moving to the next
 * layer down.
 *
 * @param node The node to start the search from.
 * @param maxChildren The maximum number of children a node can have.
 * @returns The node to insert into and the index at which to insert.
 */
export function findNextInsertLocation<T>(
    node: LayoutNode<T>,
    maxChildren: number
): { node: LayoutNode<T>; index: number } {
    const insertLoc = findNextInsertLocationHelper(node, maxChildren, 1);
    return { node: insertLoc?.node, index: insertLoc?.index };
}

function findNextInsertLocationHelper<T>(
    node: LayoutNode<T>,
    maxChildren: number,
    curDepth: number = 1
): { node: LayoutNode<T>; index: number; depth: number } {
    if (!node) return;
    if (!node.children) return { node, index: 1, depth: curDepth };
    let insertLocs: { node: LayoutNode<T>; index: number; depth: number }[] = [];
    if (node.children.length < maxChildren) {
        insertLocs.push({ node, index: node.children.length, depth: curDepth });
    }
    for (const child of node.children.slice().reverse()) {
        insertLocs.push(findNextInsertLocationHelper(child, maxChildren, curDepth + 1));
    }
    insertLocs = insertLocs
        .filter((a) => a)
        .sort((a, b) => Math.pow(a.depth, a.index + maxChildren) - Math.pow(b.depth, b.index + maxChildren));
    return insertLocs[0];
}
