// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atomWithThrottle, boundNumber } from "@/util/util";
import { Atom, atom, Getter, PrimitiveAtom, Setter } from "jotai";
import { splitAtom } from "jotai/utils";
import { createRef, CSSProperties } from "react";
import { debounce } from "throttle-debounce";
import { balanceNode, findNode, newLayoutNode, walkNodes } from "./layoutNode";
import {
    computeMoveNode,
    deleteNode,
    focusNode,
    insertNode,
    insertNodeAtIndex,
    magnifyNodeToggle,
    moveNode,
    resizeNode,
    swapNode,
} from "./layoutTree";
import {
    ContentRenderer,
    FlexDirection,
    LayoutNode,
    LayoutNodeAdditionalProps,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeFocusNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    NavigateDirection,
    NodeModel,
    PreviewRenderer,
    ResizeHandleProps,
    TileLayoutContents,
    WritableLayoutTreeStateAtom,
} from "./types";
import { getCenter, navigateDirectionToOffset, setTransform } from "./utils";

interface ResizeContext {
    handleId: string;
    pixelToSizeRatio: number;
    resizeHandleStartPx: number;
    beforeNodeStartSize: number;
    afterNodeStartSize: number;
}

const DefaultGapSizePx = 5;
const MinNodeSizePx = 40;
const DefaultAnimationTimeS = 0.15;

export class LayoutModel {
    /**
     * The jotai atom for persisting the tree state to the backend and retrieving updates from the backend.
     */
    treeStateAtom: WritableLayoutTreeStateAtom;
    /**
     * The tree state as it is persisted on the backend.
     */
    treeState: LayoutTreeState;
    /**
     * The last-recorded tree state generation.
     */
    lastTreeStateGeneration: number;
    /**
     * The jotai getter that is used to read atom values.
     */
    getter: Getter;
    /**
     * The jotai setter that is used to update atom values.
     */
    setter: Setter;
    /**
     * Callback that is invoked to render the block associated with a leaf node.
     */
    renderContent?: ContentRenderer;
    /**
     * Callback that is invoked to render the drag preview for a leaf node.
     */
    renderPreview?: PreviewRenderer;
    /**
     * Callback that is invoked when a node is closed.
     */
    onNodeDelete?: (data: TabLayoutData) => Promise<void>;
    /**
     * The size of the gap between nodes in CSS pixels.
     */
    gapSizePx: number;

    /**
     * The time a transition animation takes, in seconds.
     */
    animationTimeS: number;

    /**
     * List of nodes that are leafs and should be rendered as a DisplayNode.
     */
    leafs: PrimitiveAtom<LayoutNode[]>;
    /**
     * An ordered list of node ids starting from the top left corner to the bottom right corner.
     */
    leafOrder: PrimitiveAtom<string[]>;
    /**
     * Atom representing the number of leaf nodes in a layout.
     */
    numLeafs: Atom<number>;
    /**
     * A map of node models for currently-active leafs.
     */
    private nodeModels: Map<string, NodeModel>;

    /**
     * Split atom containing the properties of all of the resize handles that should be placed in the layout.
     */
    resizeHandles: SplitAtom<ResizeHandleProps>;
    /**
     * Layout node derived properties that are not persisted to the backend.
     * @see updateTreeHelper for the logic to update these properties.
     */
    additionalProps: PrimitiveAtom<Record<string, LayoutNodeAdditionalProps>>;
    /**
     * Set if there is currently an uncommitted action pending on the layout tree.
     * @see LayoutTreeActionType for the different types of actions.
     */
    pendingTreeAction: AtomWithThrottle<LayoutTreeAction>;
    /**
     * Whether a node is currently being dragged.
     */
    activeDrag: PrimitiveAtom<boolean>;
    /**
     * Whether the overlay container should be shown.
     * @see overlayTransform contains the actual CSS transform that moves the overlay into view.
     */
    showOverlay: PrimitiveAtom<boolean>;
    /**
     * Whether the nodes within the layout should be displaying content.
     */
    ready: PrimitiveAtom<boolean>;

    /**
     * RefObject for the display container, that holds the display nodes. This is used to get the size of the whole layout.
     */
    displayContainerRef: React.RefObject<HTMLDivElement>;
    /**
     * CSS properties for the placeholder element.
     */
    placeholderTransform: Atom<CSSProperties>;
    /**
     * CSS properties for the overlay container.
     */
    overlayTransform: Atom<CSSProperties>;

    /**
     * The currently focused node.
     */
    private focusedNodeIdStack: string[];
    /**
     * Atom pointing to the currently focused node.
     */
    focusedNode: Atom<LayoutNode>;
    /**
     * The currently magnified node.
     */
    magnifiedNodeId: string;
    /**
     * The last node to be magnified, other than the current magnified node, if set. This node should sit at a higher z-index than the others so that it floats above the other nodes as it returns to its original position.
     */
    lastMagnifiedNodeId: string;

    /**
     * The size of the resize handles, in CSS pixels.
     * The resize handle size is double the gap size, or double the default gap size, whichever is greater.
     * @see gapSizePx @see DefaultGapSizePx
     */
    private resizeHandleSizePx: number;
    /**
     * Half of the size of the resize handles, in CSS pixels.
     *
     * @see resizeHandleSizePx This is just a precomputed halving of the resize handle size.
     */
    private halfResizeHandleSizePx: number;
    /**
     * A context used by the resize handles to keep track of precomputed values for the current resize operation.
     */
    private resizeContext?: ResizeContext;
    /**
     * True if a resize handle is currently being dragged or the whole TileLayout container is being resized.
     */
    isResizing: Atom<boolean>;
    /**
     * True if the whole TileLayout container is being resized.
     */
    private isContainerResizing: PrimitiveAtom<boolean>;

    constructor(
        treeStateAtom: WritableLayoutTreeStateAtom,
        getter: Getter,
        setter: Setter,
        renderContent?: ContentRenderer,
        renderPreview?: PreviewRenderer,
        onNodeDelete?: (data: TabLayoutData) => Promise<void>,
        gapSizePx?: number,
        animationTimeS?: number
    ) {
        this.treeStateAtom = treeStateAtom;
        this.getter = getter;
        this.setter = setter;
        this.renderContent = renderContent;
        this.renderPreview = renderPreview;
        this.onNodeDelete = onNodeDelete;
        this.gapSizePx = gapSizePx ?? DefaultGapSizePx;
        this.halfResizeHandleSizePx = this.gapSizePx > 5 ? this.gapSizePx : DefaultGapSizePx;
        this.resizeHandleSizePx = 2 * this.halfResizeHandleSizePx;
        this.animationTimeS = animationTimeS ?? DefaultAnimationTimeS;

        this.leafs = atom([]);
        this.leafOrder = atom([]);
        this.numLeafs = atom((get) => get(this.leafOrder).length);

        this.nodeModels = new Map();
        this.additionalProps = atom({});

        const resizeHandleListAtom = atom((get) => {
            const addlProps = get(this.additionalProps);
            return Object.values(addlProps)
                .flatMap((props) => props.resizeHandles)
                .filter((v) => v);
        });
        this.resizeHandles = splitAtom(resizeHandleListAtom);
        this.isContainerResizing = atom(false);
        this.isResizing = atom((get) => {
            const pendingAction = get(this.pendingTreeAction.throttledValueAtom);
            const isWindowResizing = get(this.isContainerResizing);
            return isWindowResizing || pendingAction?.type === LayoutTreeActionType.ResizeNode;
        });

        this.displayContainerRef = createRef();
        this.activeDrag = atom(false);
        this.showOverlay = atom(false);
        this.ready = atom(false);
        this.overlayTransform = atom<CSSProperties>((get) => {
            const activeDrag = get(this.activeDrag);
            const showOverlay = get(this.showOverlay);
            if (this.displayContainerRef.current) {
                const displayBoundingRect = this.displayContainerRef.current.getBoundingClientRect();
                const newOverlayOffset = displayBoundingRect.top + 2 * displayBoundingRect.height;
                const newTransform = setTransform(
                    {
                        top: activeDrag || showOverlay ? 0 : newOverlayOffset,
                        left: 0,
                        width: displayBoundingRect.width,
                        height: displayBoundingRect.height,
                    },
                    false
                );
                return newTransform;
            }
        });

        this.focusedNode = atom((get) => {
            const treeState = get(this.treeStateAtom);
            if (treeState.focusedNodeId == null) {
                return null;
            }
            return findNode(treeState.rootNode, treeState.focusedNodeId);
        });
        this.focusedNodeIdStack = [];

        this.pendingTreeAction = atomWithThrottle<LayoutTreeAction>(null, 10);
        this.placeholderTransform = atom<CSSProperties>((get: Getter) => {
            const pendingAction = get(this.pendingTreeAction.throttledValueAtom);
            return this.getPlaceholderTransform(pendingAction);
        });

        this.updateTreeState(true);
    }

    /**
     * Register TileLayout callbacks that should be called on various state changes.
     * @param contents Contains callbacks provided by the TileLayout component.
     */
    registerTileLayout(contents: TileLayoutContents) {
        this.renderContent = contents.renderContent;
        this.renderPreview = contents.renderPreview;
        this.onNodeDelete = contents.onNodeDelete;
    }

    /**
     * Perform an action against the layout tree state.
     * @param action The action to perform.
     */
    treeReducer(action: LayoutTreeAction) {
        switch (action.type) {
            case LayoutTreeActionType.ComputeMove:
                this.setter(
                    this.pendingTreeAction.throttledValueAtom,
                    computeMoveNode(this.treeState, action as LayoutTreeComputeMoveNodeAction)
                );
                break;
            case LayoutTreeActionType.Move:
                moveNode(this.treeState, action as LayoutTreeMoveNodeAction);
                break;
            case LayoutTreeActionType.InsertNode:
                insertNode(this.treeState, action as LayoutTreeInsertNodeAction);
                break;
            case LayoutTreeActionType.InsertNodeAtIndex:
                insertNodeAtIndex(this.treeState, action as LayoutTreeInsertNodeAtIndexAction);
                break;
            case LayoutTreeActionType.DeleteNode:
                deleteNode(this.treeState, action as LayoutTreeDeleteNodeAction);
                break;
            case LayoutTreeActionType.Swap:
                swapNode(this.treeState, action as LayoutTreeSwapNodeAction);
                break;
            case LayoutTreeActionType.ResizeNode:
                resizeNode(this.treeState, action as LayoutTreeResizeNodeAction);
                break;
            case LayoutTreeActionType.SetPendingAction: {
                const pendingAction = (action as LayoutTreeSetPendingAction).action;
                if (pendingAction) {
                    this.setter(this.pendingTreeAction.throttledValueAtom, pendingAction);
                } else {
                    console.warn("No new pending action provided");
                }
                break;
            }
            case LayoutTreeActionType.ClearPendingAction:
                this.setter(this.pendingTreeAction.throttledValueAtom, undefined);
                break;
            case LayoutTreeActionType.CommitPendingAction: {
                const pendingAction = this.getter(this.pendingTreeAction.currentValueAtom);
                if (!pendingAction) {
                    console.error("unable to commit pending action, does not exist");
                    break;
                }
                this.treeReducer(pendingAction);
                this.setter(this.pendingTreeAction.throttledValueAtom, undefined);
                break;
            }
            case LayoutTreeActionType.FocusNode:
                focusNode(this.treeState, action as LayoutTreeFocusNodeAction);
                break;
            case LayoutTreeActionType.MagnifyNodeToggle:
                magnifyNodeToggle(this.treeState, action as LayoutTreeMagnifyNodeToggleAction);
                break;
            default:
                console.error("Invalid reducer action", this.treeState, action);
        }
        if (this.lastTreeStateGeneration !== this.treeState.generation) {
            this.lastTreeStateGeneration = this.treeState.generation;
            if (this.magnifiedNodeId !== this.treeState.magnifiedNodeId) {
                this.lastMagnifiedNodeId = this.magnifiedNodeId;
                this.magnifiedNodeId = this.treeState.magnifiedNodeId;
            }
            this.updateTree();
            this.setter(this.treeStateAtom, this.treeState);
        }
    }

    /**
     * Callback that is invoked when the tree state has been updated on the backend. This ensures the model is updated if the atom is not fully loaded when the model is first instantiated.
     * @param force Whether to force the tree state to update, regardless of whether the state is already up to date.
     */
    async updateTreeState(force = false) {
        const treeState = this.getter(this.treeStateAtom);
        // Only update the local tree state if it is different from the one in the backend. This function is called even when the update was initiated by the LayoutModel, so we need to filter out false positives or we'll enter an infinite loop.
        if (
            force ||
            !this.treeState?.rootNode ||
            !this.treeState?.generation ||
            treeState?.generation > this.treeState.generation ||
            treeState?.pendingBackendActions?.length
        ) {
            this.treeState = treeState;

            if (this.treeState.pendingBackendActions?.length) {
                const actions = this.treeState.pendingBackendActions;
                this.treeState.pendingBackendActions = undefined;
                for (const action of actions) {
                    switch (action.actiontype) {
                        case LayoutTreeActionType.InsertNode: {
                            const insertNodeAction: LayoutTreeInsertNodeAction = {
                                type: LayoutTreeActionType.InsertNode,
                                node: newLayoutNode(undefined, undefined, undefined, {
                                    blockId: action.blockid,
                                }),
                                magnified: action.magnified,
                            };
                            this.treeReducer(insertNodeAction);
                            break;
                        }
                        case LayoutTreeActionType.DeleteNode: {
                            const leaf = this?.getNodeByBlockId(action.blockid);
                            if (leaf) {
                                await this.closeNode(leaf.id);
                            } else {
                                console.error(
                                    "Cannot apply eventbus layout action DeleteNode, could not find leaf node with blockId",
                                    action.blockid
                                );
                            }
                            break;
                        }
                        case LayoutTreeActionType.InsertNodeAtIndex: {
                            if (!action.indexarr) {
                                console.error(
                                    "Cannot apply eventbus layout action InsertNodeAtIndex, indexarr field is missing."
                                );
                                break;
                            }
                            const insertAction: LayoutTreeInsertNodeAtIndexAction = {
                                type: LayoutTreeActionType.InsertNodeAtIndex,
                                node: newLayoutNode(undefined, action.nodesize, undefined, {
                                    blockId: action.blockid,
                                }),
                                indexArr: action.indexarr,
                                magnified: action.magnified,
                            };
                            this.treeReducer(insertAction);
                            break;
                        }
                        default:
                            console.warn("unsupported layout action", action);
                            break;
                    }
                }
            } else {
                this.updateTree();
            }
        }
    }

    /**
     * Recursively walks the tree to find leaf nodes, update the resize handles, and compute additional properties for each node.
     * @param balanceTree Whether the tree should also be balanced as it is walked. This should be done if the tree state has just been updated. Defaults to true.
     */
    updateTree = (balanceTree: boolean = true) => {
        if (this.displayContainerRef.current) {
            const newLeafs: LayoutNode[] = [];
            const newAdditionalProps = {};

            const pendingAction = this.getter(this.pendingTreeAction.currentValueAtom);
            const resizeAction =
                pendingAction?.type === LayoutTreeActionType.ResizeNode
                    ? (pendingAction as LayoutTreeResizeNodeAction)
                    : null;
            const callback = (node: LayoutNode) =>
                this.updateTreeHelper(node, newAdditionalProps, newLeafs, resizeAction);
            if (balanceTree) this.treeState.rootNode = balanceNode(this.treeState.rootNode, callback);
            else walkNodes(this.treeState.rootNode, callback);

            this.setter(this.additionalProps, newAdditionalProps);
            this.setter(
                this.leafs,
                newLeafs.sort((a, b) => a.id.localeCompare(b.id))
            );
            this.treeState.leafOrder = getLeafOrder(newLeafs, newAdditionalProps);
            this.setter(this.leafOrder, this.treeState.leafOrder);
            this.validateFocusedNode(this.treeState.leafOrder);
            this.cleanupNodeModels();
        }
    };

    /**
     * Per-node callback that is invoked recursively to find leaf nodes, update the resize handles, and compute additional properties associated with the given node.
     * @param node The node for which to update the resize handles and additional properties.
     * @param additionalPropsMap The new map that will contain the updated additional properties for all nodes in the tree.
     * @param leafs The new list that will contain all the leaf nodes in the tree.
     * @param resizeAction The pending resize action, if any. Used to set temporary size values on nodes that are being resized.
     */
    private updateTreeHelper(
        node: LayoutNode,
        additionalPropsMap: Record<string, LayoutNodeAdditionalProps>,
        leafs: LayoutNode[],
        resizeAction?: LayoutTreeResizeNodeAction
    ) {
        /**
         * Gets normalized dimensions for the TileLayout container.
         * @returns The normalized dimensions for the TileLayout container.
         */
        const getBoundingRect: () => Dimensions = () => {
            const boundingRect = this.displayContainerRef.current.getBoundingClientRect();
            return { top: 0, left: 0, width: boundingRect.width, height: boundingRect.height };
        };

        if (!node.children?.length) {
            leafs.push(node);
            const addlProps = additionalPropsMap[node.id];
            if (addlProps) {
                if (this.magnifiedNodeId === node.id) {
                    const boundingRect = getBoundingRect();
                    const transform = setTransform(
                        {
                            top: boundingRect.height * 0.05,
                            left: boundingRect.width * 0.05,
                            width: boundingRect.width * 0.9,
                            height: boundingRect.height * 0.9,
                        },
                        true
                    );
                    addlProps.transform = transform;
                    addlProps.isMagnifiedNode = true;
                }
                addlProps.isLastMagnifiedNode = this.lastMagnifiedNodeId === node.id;
            }
            return;
        }

        function getNodeSize(node: LayoutNode) {
            return resizeAction?.resizeOperations.find((op) => op.nodeId === node.id)?.size ?? node.size;
        }

        const additionalProps: LayoutNodeAdditionalProps = additionalPropsMap.hasOwnProperty(node.id)
            ? additionalPropsMap[node.id]
            : { treeKey: "0" };

        const nodeRect: Dimensions = node.id === this.treeState.rootNode.id ? getBoundingRect() : additionalProps.rect;
        const nodeIsRow = node.flexDirection === FlexDirection.Row;
        const nodePixels = nodeIsRow ? nodeRect.width : nodeRect.height;
        const totalChildrenSize = node.children.reduce((acc, child) => acc + getNodeSize(child), 0);
        const pixelToSizeRatio = totalChildrenSize / nodePixels;

        let lastChildRect: Dimensions;
        const resizeHandles: ResizeHandleProps[] = [];
        node.children.forEach((child, i) => {
            const childSize = getNodeSize(child);
            const rect: Dimensions = {
                top: !nodeIsRow && lastChildRect ? lastChildRect.top + lastChildRect.height : nodeRect.top,
                left: nodeIsRow && lastChildRect ? lastChildRect.left + lastChildRect.width : nodeRect.left,
                width: nodeIsRow ? childSize / pixelToSizeRatio : nodeRect.width,
                height: nodeIsRow ? nodeRect.height : childSize / pixelToSizeRatio,
            };
            const transform = setTransform(rect);
            additionalPropsMap[child.id] = {
                rect,
                transform,
                treeKey: additionalProps.treeKey + i,
            };

            // We only want the resize handles in between nodes, this ensures we have n-1 handles.
            if (lastChildRect) {
                const resizeHandleIndex = resizeHandles.length;
                const resizeHandleDimensions: Dimensions = {
                    top: nodeIsRow
                        ? lastChildRect.top
                        : lastChildRect.top + lastChildRect.height - this.halfResizeHandleSizePx,
                    left: nodeIsRow
                        ? lastChildRect.left + lastChildRect.width - this.halfResizeHandleSizePx
                        : lastChildRect.left,
                    width: nodeIsRow ? this.resizeHandleSizePx : lastChildRect.width,
                    height: nodeIsRow ? lastChildRect.height : this.resizeHandleSizePx,
                };
                resizeHandles.push({
                    id: `${node.id}-${resizeHandleIndex}`,
                    parentNodeId: node.id,
                    parentIndex: resizeHandleIndex,
                    transform: setTransform(resizeHandleDimensions, true, false),
                    flexDirection: node.flexDirection,
                    centerPx:
                        (nodeIsRow ? resizeHandleDimensions.left : resizeHandleDimensions.top) +
                        this.halfResizeHandleSizePx,
                });
            }
            lastChildRect = rect;
        });

        additionalPropsMap[node.id] = {
            ...additionalProps,
            pixelToSizeRatio,
            resizeHandles,
        };
    }

    /**
     * The id of the focused node in the layout.
     */
    get focusedNodeId(): string {
        return this.focusedNodeIdStack[0];
    }

    /**
     * Checks whether the focused node id has changed and, if so, whether to update the focused node stack. If the focused node was deleted, will pop the latest value from the stack.
     * @param leafOrder The new leaf order array to use when searching for stale nodes in the stack.
     */
    private validateFocusedNode(leafOrder: string[]) {
        if (this.treeState.focusedNodeId !== this.focusedNodeId) {
            // Remove duplicates and stale entries from focus stack.
            const newFocusedNodeIdStack: string[] = [];
            for (const id of this.focusedNodeIdStack) {
                if (leafOrder.includes(id) && !newFocusedNodeIdStack.includes(id)) newFocusedNodeIdStack.push(id);
            }
            this.focusedNodeIdStack = newFocusedNodeIdStack;

            // Update the focused node and stack based on the changes in the tree state.
            if (!this.treeState.focusedNodeId) {
                if (this.focusedNodeIdStack.length > 0) {
                    this.treeState.focusedNodeId = this.focusedNodeIdStack.shift();
                } else {
                    // If no nodes are in the stack, use the top left node in the layout.
                    this.treeState.focusedNodeId = leafOrder[0];
                }
            }
            this.focusedNodeIdStack.unshift(this.treeState.focusedNodeId);
        }
    }

    /**
     * Helper function for the placeholderTransform atom, which computes the new transform value when the pending action changes.
     * @param pendingAction The new pending action value.
     * @returns The computed placeholder transform.
     *
     * @see placeholderTransform the atom that invokes this function and persists the updated value.
     */
    private getPlaceholderTransform(pendingAction: LayoutTreeAction): CSSProperties {
        if (pendingAction) {
            switch (pendingAction.type) {
                case LayoutTreeActionType.Move: {
                    const action = pendingAction as LayoutTreeMoveNodeAction;
                    let parentId: string;
                    if (action.insertAtRoot) {
                        parentId = this.treeState.rootNode.id;
                    } else {
                        parentId = action.parentId;
                    }

                    const parentNode = findNode(this.treeState.rootNode, parentId);
                    if (action.index !== undefined && parentNode) {
                        const targetIndex = boundNumber(
                            action.index - 1,
                            0,
                            parentNode.children ? parentNode.children.length - 1 : 0
                        );
                        const targetNode = parentNode?.children?.at(targetIndex) ?? parentNode;
                        if (targetNode) {
                            const targetBoundingRect = this.getNodeRect(targetNode);

                            // Placeholder should be either half the height or half the width of the targetNode, depending on the flex direction of the targetNode's parent.
                            // Default to placing the placeholder in the first half of the target node.
                            const placeholderDimensions: Dimensions = {
                                height:
                                    parentNode.flexDirection === FlexDirection.Column
                                        ? targetBoundingRect.height / 2
                                        : targetBoundingRect.height,
                                width:
                                    parentNode.flexDirection === FlexDirection.Row
                                        ? targetBoundingRect.width / 2
                                        : targetBoundingRect.width,
                                top: targetBoundingRect.top,
                                left: targetBoundingRect.left,
                            };

                            if (action.index > targetIndex) {
                                if (action.index >= (parentNode.children?.length ?? 1)) {
                                    // If there are no more nodes after the specified index, place the placeholder in the second half of the target node (either right or bottom).
                                    placeholderDimensions.top +=
                                        parentNode.flexDirection === FlexDirection.Column &&
                                        targetBoundingRect.height / 2;
                                    placeholderDimensions.left +=
                                        parentNode.flexDirection === FlexDirection.Row && targetBoundingRect.width / 2;
                                } else {
                                    // Otherwise, place the placeholder between the target node (the one after which it will be inserted) and the next node
                                    placeholderDimensions.top +=
                                        parentNode.flexDirection === FlexDirection.Column &&
                                        (3 * targetBoundingRect.height) / 4;
                                    placeholderDimensions.left +=
                                        parentNode.flexDirection === FlexDirection.Row &&
                                        (3 * targetBoundingRect.width) / 4;
                                }
                            }

                            return setTransform(placeholderDimensions);
                        }
                    }
                    break;
                }
                case LayoutTreeActionType.Swap: {
                    const action = pendingAction as LayoutTreeSwapNodeAction;
                    const targetNodeId = action.node1Id;
                    const targetBoundingRect = this.getNodeRectById(targetNodeId);
                    const placeholderDimensions: Dimensions = {
                        top: targetBoundingRect.top,
                        left: targetBoundingRect.left,
                        height: targetBoundingRect.height,
                        width: targetBoundingRect.width,
                    };

                    return setTransform(placeholderDimensions);
                }
                default:
                    // No-op
                    break;
            }
        }
        return;
    }

    /**
     * Gets the node model for the given node.
     * @param node The node for which to retrieve the node model.
     * @returns The node model for the given node.
     */
    getNodeModel(node: LayoutNode): NodeModel {
        const nodeid = node.id;
        const blockId = node.data.blockId;
        const addlPropsAtom = this.getNodeAdditionalPropertiesAtom(nodeid);
        if (!this.nodeModels.has(nodeid)) {
            this.nodeModels.set(nodeid, {
                additionalProps: addlPropsAtom,
                animationTimeS: this.animationTimeS,
                innerRect: atom((get) => {
                    const addlProps = get(addlPropsAtom);
                    const numLeafs = get(this.numLeafs);
                    if (numLeafs > 1 && addlProps?.rect) {
                        return {
                            width: `${addlProps.transform.width} - ${this.gapSizePx}px`,
                            height: `${addlProps.transform.height} - ${this.gapSizePx}px`,
                        } as CSSProperties;
                    } else {
                        return null;
                    }
                }),
                nodeId: nodeid,
                blockId,
                blockNum: atom((get) => get(this.leafOrder).indexOf(nodeid) + 1),
                isResizing: this.isResizing,
                isFocused: atom((get) => {
                    const treeState = get(this.treeStateAtom);
                    const isFocused = treeState.focusedNodeId === nodeid;
                    return isFocused;
                }),
                isMagnified: atom((get) => {
                    const treeState = get(this.treeStateAtom);
                    return treeState.magnifiedNodeId === nodeid;
                }),
                ready: this.ready,
                disablePointerEvents: this.activeDrag,
                onClose: async () => await this.closeNode(nodeid),
                toggleMagnify: () => this.magnifyNodeToggle(nodeid),
                focusNode: () => this.focusNode(nodeid),
                dragHandleRef: createRef(),
            });
        }
        const nodeModel = this.nodeModels.get(nodeid);
        return nodeModel;
    }

    private cleanupNodeModels() {
        const leafOrder = this.getter(this.leafOrder);
        const orphanedNodeModels = [...this.nodeModels.keys()].filter((id) => !leafOrder.includes(id));
        for (const id of orphanedNodeModels) {
            this.nodeModels.delete(id);
        }
    }

    /**
     * Switch focus to the next node in the given direction in the layout.
     * @param direction The direction in which to switch focus.
     */
    switchNodeFocusInDirection(direction: NavigateDirection) {
        const curNodeId = this.focusedNodeId;

        // If no node is focused, set focus to the first leaf.
        if (!curNodeId) {
            this.focusNode(this.getter(this.leafOrder)[0]);
            return;
        }

        const offset = navigateDirectionToOffset(direction);
        const nodePositions: Map<string, Dimensions> = new Map();
        const leafs = this.getter(this.leafs);
        const addlProps = this.getter(this.additionalProps);
        for (const leaf of leafs) {
            const pos = addlProps[leaf.id]?.rect;
            if (pos) {
                nodePositions.set(leaf.id, pos);
            }
        }
        const curNodePos = nodePositions.get(curNodeId);
        if (!curNodePos) {
            return;
        }
        nodePositions.delete(curNodeId);
        const boundingRect = this.displayContainerRef?.current.getBoundingClientRect();
        if (!boundingRect) {
            return;
        }
        const maxX = boundingRect.left + boundingRect.width;
        const maxY = boundingRect.top + boundingRect.height;
        const moveAmount = 10;
        const curPoint = getCenter(curNodePos);

        function findNodeAtPoint(m: Map<string, Dimensions>, p: Point): string {
            for (const [blockId, dimension] of m.entries()) {
                if (
                    p.x >= dimension.left &&
                    p.x <= dimension.left + dimension.width &&
                    p.y >= dimension.top &&
                    p.y <= dimension.top + dimension.height
                ) {
                    return blockId;
                }
            }
            return null;
        }

        while (true) {
            curPoint.x += offset.x * moveAmount;
            curPoint.y += offset.y * moveAmount;
            if (curPoint.x < 0 || curPoint.x > maxX || curPoint.y < 0 || curPoint.y > maxY) {
                return;
            }
            const nodeId = findNodeAtPoint(nodePositions, curPoint);
            if (nodeId != null) {
                this.focusNode(nodeId);
                return;
            }
        }
    }

    /**
     * Switch focus to a node using the given BlockNum
     * @param newBlockNum The BlockNum of the node to which focus should switch.
     * @see leafOrder - the indices in this array determine BlockNum
     */
    switchNodeFocusByBlockNum(newBlockNum: number) {
        const leafOrder = this.getter(this.leafOrder);
        const newLeafIdx = newBlockNum - 1;
        if (newLeafIdx < 0 || newLeafIdx >= leafOrder.length) {
            return;
        }
        const leafId = leafOrder[newLeafIdx];
        this.focusNode(leafId);
    }

    /**
     * Set the layout to focus on the given node.
     * @param nodeId The id of the node that is being focused.
     */
    focusNode(nodeId: string) {
        if (this.focusedNodeId === nodeId) return;
        const action: LayoutTreeFocusNodeAction = {
            type: LayoutTreeActionType.FocusNode,
            nodeId: nodeId,
        };

        this.treeReducer(action);
    }

    /**
     * Toggle magnification of a given node.
     * @param nodeId The id of the node that is being magnified.
     */
    magnifyNodeToggle(nodeId: string) {
        const action: LayoutTreeMagnifyNodeToggleAction = {
            type: LayoutTreeActionType.MagnifyNodeToggle,
            nodeId: nodeId,
        };

        this.treeReducer(action);
    }

    /**
     * Close a given node and update the tree state.
     * @param nodeId The id of the node that is being closed.
     */
    async closeNode(nodeId: string) {
        const nodeToDelete = findNode(this.treeState.rootNode, nodeId);
        if (!nodeToDelete) {
            console.error("unable to close node, cannot find it in tree", nodeId);
            return;
        }
        const deleteAction: LayoutTreeDeleteNodeAction = {
            type: LayoutTreeActionType.DeleteNode,
            nodeId: nodeId,
        };
        this.treeReducer(deleteAction);
        await this.onNodeDelete?.(nodeToDelete.data);
    }

    /**
     * Shorthand function for closing the focused node in a layout.
     */
    async closeFocusedNode() {
        await this.closeNode(this.focusedNodeId);
    }

    /**
     * Callback that is invoked when a drag operation completes and the pending action should be committed.
     */
    onDrop() {
        if (this.getter(this.pendingTreeAction.currentValueAtom)) {
            this.treeReducer({
                type: LayoutTreeActionType.CommitPendingAction,
            });
        }
    }

    /**
     * Callback that is invoked when the TileLayout container is being resized.
     */
    onContainerResize = () => {
        this.updateTree();
        this.setter(this.isContainerResizing, true);
        this.stopContainerResizing();
    };

    /**
     * Deferred action to restore animations once the TileLayout container is no longer being resized.
     */
    stopContainerResizing = debounce(30, () => {
        this.setter(this.isContainerResizing, false);
    });

    /**
     * Callback to update pending node sizes when a resize handle is dragged.
     * @param resizeHandle The resize handle that is being dragged.
     * @param x The X coordinate of the pointer device, in CSS pixels.
     * @param y The Y coordinate of the pointer device, in CSS pixels.
     */
    onResizeMove(resizeHandle: ResizeHandleProps, x: number, y: number) {
        const parentIsRow = resizeHandle.flexDirection === FlexDirection.Row;
        const parentNode = findNode(this.treeState.rootNode, resizeHandle.parentNodeId);
        const beforeNode = parentNode.children![resizeHandle.parentIndex];
        const afterNode = parentNode.children![resizeHandle.parentIndex + 1];

        // If the resize context is out of date, update it and save it for future events.
        if (this.resizeContext?.handleId !== resizeHandle.id) {
            const addlProps = this.getter(this.additionalProps);
            const pixelToSizeRatio = addlProps[resizeHandle.parentNodeId]?.pixelToSizeRatio;
            if (beforeNode && afterNode && pixelToSizeRatio) {
                this.resizeContext = {
                    handleId: resizeHandle.id,
                    resizeHandleStartPx: resizeHandle.centerPx,
                    beforeNodeStartSize: beforeNode.size,
                    afterNodeStartSize: afterNode.size,
                    pixelToSizeRatio,
                };
            } else {
                console.error(
                    "Invalid resize handle, cannot get the additional properties for the nodes in the resize handle properties."
                );
                return;
            }
        }

        const clientPoint = parentIsRow ? x : y;
        const clientDiff = (this.resizeContext.resizeHandleStartPx - clientPoint) * this.resizeContext.pixelToSizeRatio;
        const minNodeSize = MinNodeSizePx * this.resizeContext.pixelToSizeRatio;
        const beforeNodeSize = this.resizeContext.beforeNodeStartSize - clientDiff;
        const afterNodeSize = this.resizeContext.afterNodeStartSize + clientDiff;

        // If either node will be too small after this resize, don't let it happen.
        if (beforeNodeSize < minNodeSize || afterNodeSize < minNodeSize) {
            return;
        }

        const resizeAction: LayoutTreeResizeNodeAction = {
            type: LayoutTreeActionType.ResizeNode,
            resizeOperations: [
                {
                    nodeId: beforeNode.id,
                    size: beforeNodeSize,
                },
                {
                    nodeId: afterNode.id,
                    size: afterNodeSize,
                },
            ],
        };
        const setPendingAction: LayoutTreeSetPendingAction = {
            type: LayoutTreeActionType.SetPendingAction,
            action: resizeAction,
        };

        this.treeReducer(setPendingAction);
        this.updateTree(false);
    }

    /**
     * Callback to end the current resize operation and commit its pending action.
     */
    onResizeEnd() {
        if (this.resizeContext) {
            this.resizeContext = undefined;
            this.treeReducer({ type: LayoutTreeActionType.CommitPendingAction });
        }
    }

    /**
     * Get the layout node matching the specified blockId.
     * @param blockId The blockId that the returned node should contain.
     * @returns The node containing the specified blockId, null if not found.
     */
    getNodeByBlockId(blockId: string): LayoutNode {
        for (const leaf of this.getter(this.leafs)) {
            if (leaf.data.blockId === blockId) {
                return leaf;
            }
        }
        return null;
    }

    /**
     * Get a jotai atom containing the additional properties associated with a given node.
     * @param nodeId The ID of the node for which to retrieve the additional properties.
     * @returns An atom containing the additional properties associated with the given node.
     */
    getNodeAdditionalPropertiesAtom(nodeId: string): Atom<LayoutNodeAdditionalProps> {
        return atom((get) => {
            const addlProps = get(this.additionalProps);
            if (addlProps.hasOwnProperty(nodeId)) return addlProps[nodeId];
        });
    }

    /**
     * Get additional properties associated with a given node.
     * @param nodeId The ID of the node for which to retrieve the additional properties.
     * @returns The additional properties associated with the given node.
     */
    getNodeAdditionalPropertiesById(nodeId: string): LayoutNodeAdditionalProps {
        const addlProps = this.getter(this.additionalProps);
        if (addlProps.hasOwnProperty(nodeId)) return addlProps[nodeId];
    }

    /**
     * Get additional properties associated with a given node.
     * @param node The node for which to retrieve the additional properties.
     * @returns The additional properties associated with the given node.
     */
    getNodeAdditionalProperties(node: LayoutNode): LayoutNodeAdditionalProps {
        return this.getNodeAdditionalPropertiesById(node.id);
    }

    /**
     * Get the CSS transform associated with a given node.
     * @param nodeId The ID of the node for which to retrieve the CSS transform.
     * @returns The CSS transform associated with the given node.
     */
    getNodeTransformById(nodeId: string): CSSProperties {
        return this.getNodeAdditionalPropertiesById(nodeId)?.transform;
    }

    /**
     * Get the CSS transform associated with a given node.
     * @param node The node for which to retrieve the CSS transform.
     * @returns The CSS transform associated with the given node.
     */
    getNodeTransform(node: LayoutNode): CSSProperties {
        return this.getNodeTransformById(node.id);
    }

    /**
     * Get the computed dimensions in CSS pixels of a given node.
     * @param nodeId The ID of the node for which to retrieve the computed dimensions.
     * @returns The computed dimensions of the given node, in CSS pixels.
     */
    getNodeRectById(nodeId: string): Dimensions {
        return this.getNodeAdditionalPropertiesById(nodeId)?.rect;
    }

    /**
     * Get the computed dimensions in CSS pixels of a given node.
     * @param node The node for which to retrieve the computed dimensions.
     * @returns The computed dimensions of the given node, in CSS pixels.
     */
    getNodeRect(node: LayoutNode): Dimensions {
        return this.getNodeRectById(node.id);
    }
}

function getLeafOrder(leafs: LayoutNode[], additionalProps: Record<string, LayoutNodeAdditionalProps>): string[] {
    return leafs
        .map((node) => node.id)
        .sort((a, b) => {
            const treeKeyA = additionalProps[a]?.treeKey;
            const treeKeyB = additionalProps[b]?.treeKey;
            if (!treeKeyA || !treeKeyB) return;
            return treeKeyA.localeCompare(treeKeyB);
        });
}
