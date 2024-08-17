import { atomWithThrottle, boundNumber } from "@/util/util";
import { Atom, atom, Getter, PrimitiveAtom, Setter } from "jotai";
import { splitAtom } from "jotai/utils";
import { createRef, CSSProperties } from "react";
import { debounce } from "throttle-debounce";
import { balanceNode, findNode, walkNodes } from "./layoutNode";
import {
    computeMoveNode,
    deleteNode,
    insertNode,
    insertNodeAtIndex,
    magnifyNodeToggle,
    moveNode,
    resizeNode,
    swapNode,
} from "./layoutTree";
import {
    ContentRenderer,
    LayoutNode,
    LayoutNodeAdditionalProps,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    PreviewRenderer,
    ResizeHandleProps,
    TileLayoutContents,
    WritableLayoutTreeStateAtom,
} from "./types";
import { Dimensions, FlexDirection, setTransform } from "./utils";

interface ResizeContext {
    handleId: string;
    pixelToSizeRatio: number;
    resizeHandleStartPx: number;
    beforeNodeStartSize: number;
    afterNodeStartSize: number;
}

const DefaultGapSizePx = 5;
const MinNodeSizePx = 40;

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
     * List of nodes that are leafs and should be rendered as a DisplayNode
     */
    leafs: LayoutNode[];
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
    pendingAction: AtomWithThrottle<LayoutTreeAction>;
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
    /**
     * An arbitrary generation value that is incremented every time the updateTree function runs. Helps indicate to subscribers that they should update their memoized values.
     */
    generationAtom: PrimitiveAtom<number>;

    constructor(
        treeStateAtom: WritableLayoutTreeStateAtom,
        getter: Getter,
        setter: Setter,
        renderContent?: ContentRenderer,
        renderPreview?: PreviewRenderer,
        onNodeDelete?: (data: TabLayoutData) => Promise<void>,
        gapSizePx?: number
    ) {
        console.log("ctor");
        this.treeStateAtom = treeStateAtom;
        this.getter = getter;
        this.setter = setter;
        this.renderContent = renderContent;
        this.renderPreview = renderPreview;
        this.onNodeDelete = onNodeDelete;
        this.gapSizePx = gapSizePx ?? DefaultGapSizePx;
        this.halfResizeHandleSizePx = this.gapSizePx > 5 ? this.gapSizePx : DefaultGapSizePx;
        this.resizeHandleSizePx = 2 * this.halfResizeHandleSizePx;

        this.leafs = [];
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
            const pendingAction = get(this.pendingAction.throttledValueAtom);
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

        this.pendingAction = atomWithThrottle<LayoutTreeAction>(null, 10);
        this.placeholderTransform = atom<CSSProperties>((get: Getter) => {
            const pendingAction = get(this.pendingAction.throttledValueAtom);
            // console.log("update to pending action", pendingAction);
            return this.getPlaceholderTransform(pendingAction);
        });

        this.generationAtom = atom(0);
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
        // console.log("treeReducer", action, this);
        let stateChanged = false;
        switch (action.type) {
            case LayoutTreeActionType.ComputeMove:
                this.setter(
                    this.pendingAction.throttledValueAtom,
                    computeMoveNode(this.treeState, action as LayoutTreeComputeMoveNodeAction)
                );
                break;
            case LayoutTreeActionType.Move:
                moveNode(this.treeState, action as LayoutTreeMoveNodeAction);
                stateChanged = true;
                break;
            case LayoutTreeActionType.InsertNode:
                insertNode(this.treeState, action as LayoutTreeInsertNodeAction);
                stateChanged = true;
                break;
            case LayoutTreeActionType.InsertNodeAtIndex:
                insertNodeAtIndex(this.treeState, action as LayoutTreeInsertNodeAtIndexAction);
                stateChanged = true;
                break;
            case LayoutTreeActionType.DeleteNode:
                deleteNode(this.treeState, action as LayoutTreeDeleteNodeAction);
                stateChanged = true;
                break;
            case LayoutTreeActionType.Swap:
                swapNode(this.treeState, action as LayoutTreeSwapNodeAction);
                stateChanged = true;
                break;
            case LayoutTreeActionType.ResizeNode:
                resizeNode(this.treeState, action as LayoutTreeResizeNodeAction);
                stateChanged = true;
                break;
            case LayoutTreeActionType.SetPendingAction: {
                const pendingAction = (action as LayoutTreeSetPendingAction).action;
                if (pendingAction) {
                    this.setter(this.pendingAction.throttledValueAtom, pendingAction);
                } else {
                    console.warn("No new pending action provided");
                }
                break;
            }
            case LayoutTreeActionType.ClearPendingAction:
                this.setter(this.pendingAction.throttledValueAtom, undefined);
                break;
            case LayoutTreeActionType.CommitPendingAction: {
                const pendingAction = this.getter(this.pendingAction.currentValueAtom);
                if (!pendingAction) {
                    console.error("unable to commit pending action, does not exist");
                    break;
                }
                this.treeReducer(pendingAction);
                this.setter(this.pendingAction.throttledValueAtom, undefined);
                break;
            }
            case LayoutTreeActionType.MagnifyNodeToggle:
                magnifyNodeToggle(this.treeState, action as LayoutTreeMagnifyNodeToggleAction);
                stateChanged = true;
                break;
            default:
                console.error("Invalid reducer action", this.treeState, action);
        }
        if (stateChanged) {
            console.log("state changed", this.treeState);
            this.updateTree();
            this.treeState.generation++;
            this.setter(this.treeStateAtom, this.treeState);
        }
    }

    /**
     * Callback that is invoked when the tree state has been updated on the backend. This ensures the model is updated if the atom is not fully loaded when the model is first instantiated.
     * @param force Whether to force the tree state to update, regardless of whether the state is already up to date.
     */
    updateTreeState(force = false) {
        const treeState = this.getter(this.treeStateAtom);
        // Only update the local tree state if it is different from the one in the backend. This function is called even when the update was initiated by the LayoutModel, so we need to filter out false positives or we'll enter an infinite loop.
        if (
            force ||
            !this.treeState?.rootNode ||
            !this.treeState?.generation ||
            treeState?.generation > this.treeState.generation
        ) {
            this.treeState = treeState;
            this.updateTree();
        }
    }

    /**
     * Recursively walks the tree to find leaf nodes, update the resize handles, and compute additional properties for each node.
     * @param balanceTree Whether the tree should also be balanced as it is walked. This should be done if the tree state has just been updated. Defaults to true.
     */
    updateTree = (balanceTree: boolean = true) => {
        // console.log("updateTree");
        if (this.displayContainerRef.current) {
            // console.log("updateTree 1");
            const newLeafs: LayoutNode[] = [];
            const newAdditionalProps = {};

            const pendingAction = this.getter(this.pendingAction.currentValueAtom);
            const resizeAction =
                pendingAction?.type === LayoutTreeActionType.ResizeNode
                    ? (pendingAction as LayoutTreeResizeNodeAction)
                    : null;
            const callback = (node: LayoutNode) =>
                this.updateTreeHelper(node, newAdditionalProps, newLeafs, resizeAction);
            if (balanceTree) this.treeState.rootNode = balanceNode(this.treeState.rootNode, callback);
            else walkNodes(this.treeState.rootNode, callback);

            this.setter(this.additionalProps, newAdditionalProps);
            this.leafs = newLeafs.sort((a, b) => a.id.localeCompare(b.id));

            this.setter(this.generationAtom, this.getter(this.generationAtom) + 1);
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
            // console.log("adding node to leafs", node);
            leafs.push(node);
            const addlProps = additionalPropsMap[node.id];
            if (addlProps) {
                if (this.treeState.magnifiedNodeId === node.id) {
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
            : {};

        const nodeRect: Dimensions = node.id === this.treeState.rootNode.id ? getBoundingRect() : additionalProps.rect;
        const nodeIsRow = node.flexDirection === FlexDirection.Row;
        const nodePixels = nodeIsRow ? nodeRect.width : nodeRect.height;
        const totalChildrenSize = node.children.reduce((acc, child) => acc + getNodeSize(child), 0);
        const pixelToSizeRatio = totalChildrenSize / nodePixels;

        let lastChildRect: Dimensions;
        const resizeHandles: ResizeHandleProps[] = [];
        for (const child of node.children) {
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
        }

        additionalPropsMap[node.id] = {
            ...additionalProps,
            pixelToSizeRatio,
            resizeHandles,
        };
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
            // console.log("pendingAction", pendingAction, this);
            switch (pendingAction.type) {
                case LayoutTreeActionType.Move: {
                    // console.log("doing move overlay");
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
                    // console.log("doing swap overlay");
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
     * Toggle magnification of a given node.
     * @param node The node that is being magnified.
     */
    magnifyNodeToggle(node: LayoutNode) {
        const action = {
            type: LayoutTreeActionType.MagnifyNodeToggle,
            nodeId: node.id,
        };

        // If the node is already magnified, then it is being un-magnified and should be set as the last-magnified node to ensure it has a higher z-index as it transitions back to its original position.
        if (this.treeState.magnifiedNodeId === node.id) {
            console.log("new last-magnified-node", node.id);
            this.lastMagnifiedNodeId = node.id;
        }

        this.treeReducer(action);
    }

    /**
     * Close a given node and update the tree state.
     * @param node The node that is being closed.
     */
    async closeNode(node: LayoutNode) {
        const deleteAction: LayoutTreeDeleteNodeAction = {
            type: LayoutTreeActionType.DeleteNode,
            nodeId: node.id,
        };
        this.treeReducer(deleteAction);
        await this.onNodeDelete?.(node.data);
    }

    async closeNodeById(nodeId: string) {
        const nodeToDelete = findNode(this.treeState.rootNode, nodeId);
        await this.closeNode(nodeToDelete);
    }

    onDrop() {
        if (this.getter(this.pendingAction.currentValueAtom)) {
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
        // console.log("onResizeMove", resizeHandle, x, y, this.resizeContext);
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

        const boundingRect = this.displayContainerRef.current?.getBoundingClientRect();
        x -= boundingRect?.top + 10;
        y -= boundingRect?.left - 10;

        const clientPoint = parentIsRow ? x : y;
        const clientDiff = (this.resizeContext.resizeHandleStartPx - clientPoint) * this.resizeContext.pixelToSizeRatio;
        const beforeNodeSize = this.resizeContext.beforeNodeStartSize - clientDiff;
        const afterNodeSize = this.resizeContext.afterNodeStartSize + clientDiff;

        // If either node will be too small after this resize, don't let it happen.
        if (
            beforeNodeSize / this.resizeContext.pixelToSizeRatio < MinNodeSizePx ||
            afterNodeSize / this.resizeContext.pixelToSizeRatio < MinNodeSizePx
        ) {
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

    getNodeByBlockId(blockId: string) {
        for (const leaf of this.leafs) {
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
            // console.log(
            //     "updated addlProps",
            //     nodeId,
            //     addlProps?.[nodeId]?.transform,
            //     addlProps?.[nodeId]?.rect,
            //     addlProps?.[nodeId]?.pixelToSizeRatio
            // );
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
