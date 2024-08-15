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
    TileLayoutContents,
    WritableLayoutTreeStateAtom,
} from "./types";
import { Dimensions, FlexDirection, setTransform } from "./utils";

export interface ResizeHandleProps {
    id: string;
    parentNodeId: string;
    parentIndex: number;
    centerPx: number;
    transform: CSSProperties;
    flexDirection: FlexDirection;
}

export interface LayoutNodeAdditionalProps {
    transform?: CSSProperties;
    rect?: Dimensions;
    pixelToSizeRatio?: number;
    resizeHandles?: ResizeHandleProps[];
}

interface ResizeContext {
    handleId: string;
    pixelToSizeRatio: number;
    resizeHandleStartPx: number;
    beforeNodeStartSize: number;
    afterNodeStartSize: number;
}

const DefaultGapSizePx = 5;

export class LayoutModel {
    treeStateAtom: WritableLayoutTreeStateAtom;
    getter: Getter;
    setter: Setter;
    renderContent?: ContentRenderer;
    renderPreview?: PreviewRenderer;
    onNodeDelete?: (data: TabLayoutData) => Promise<void>;
    gapSizePx: number;

    treeState: LayoutTreeState;
    leafs: LayoutNode[];
    resizeHandles: SplitAtom<ResizeHandleProps>;
    additionalProps: PrimitiveAtom<Record<string, LayoutNodeAdditionalProps>>;
    pendingAction: AtomWithThrottle<LayoutTreeAction>;
    activeDrag: PrimitiveAtom<boolean>;
    showOverlay: PrimitiveAtom<boolean>;
    ready: PrimitiveAtom<boolean>;

    displayContainerRef: React.RefObject<HTMLDivElement>;
    placeholderTransform: Atom<CSSProperties>;
    overlayTransform: Atom<CSSProperties>;

    private resizeContext?: ResizeContext;
    isResizing: Atom<boolean>;
    private isContainerResizing: PrimitiveAtom<boolean>;
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
            console.log("update to pending action", pendingAction);
            return this.getPlaceholderTransform(pendingAction);
        });

        this.generationAtom = atom(0);
        this.updateTreeState(true);
    }

    registerTileLayout(contents: TileLayoutContents) {
        this.renderContent = contents.renderContent;
        this.renderPreview = contents.renderPreview;
        this.onNodeDelete = contents.onNodeDelete;
    }

    treeReducer(action: LayoutTreeAction) {
        console.log("treeReducer", action, this);
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

    updateTreeState(force = false) {
        const treeState = this.getter(this.treeStateAtom);
        console.log("updateTreeState", this.treeState, treeState);
        if (
            force ||
            !this.treeState?.rootNode ||
            !this.treeState?.generation ||
            treeState?.generation > this.treeState.generation
        ) {
            console.log("newTreeState", treeState);
            this.treeState = treeState;
            this.updateTree();
        }
    }

    private bumpGeneration() {
        console.log("bumpGeneration");
        this.setter(this.generationAtom, this.getter(this.generationAtom) + 1);
    }

    getNodeAdditionalPropertiesAtom(nodeId: string): Atom<LayoutNodeAdditionalProps> {
        return atom((get) => {
            const addlProps = get(this.additionalProps);
            console.log(
                "updated addlProps",
                nodeId,
                addlProps?.[nodeId]?.transform,
                addlProps?.[nodeId]?.rect,
                addlProps?.[nodeId]?.pixelToSizeRatio
            );
            if (addlProps.hasOwnProperty(nodeId)) return addlProps[nodeId];
        });
    }

    getNodeAdditionalPropertiesById(nodeId: string): LayoutNodeAdditionalProps {
        const addlProps = this.getter(this.additionalProps);
        if (addlProps.hasOwnProperty(nodeId)) return addlProps[nodeId];
    }

    getNodeAdditionalProperties(node: LayoutNode): LayoutNodeAdditionalProps {
        return this.getNodeAdditionalPropertiesById(node.id);
    }

    getNodeTransform(node: LayoutNode): CSSProperties {
        return this.getNodeTransformById(node.id);
    }

    getNodeTransformById(nodeId: string): CSSProperties {
        return this.getNodeAdditionalPropertiesById(nodeId)?.transform;
    }

    getNodeRect(node: LayoutNode): Dimensions {
        return this.getNodeRectById(node.id);
    }

    getNodeRectById(nodeId: string): Dimensions {
        return this.getNodeAdditionalPropertiesById(nodeId)?.rect;
    }

    updateTree = (balanceTree: boolean = true) => {
        console.log("updateTree");
        if (this.displayContainerRef.current) {
            console.log("updateTree 1");
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

            this.bumpGeneration();
        }
    };

    private getBoundingRect(): Dimensions {
        const boundingRect = this.displayContainerRef.current.getBoundingClientRect();
        return { top: 0, left: 0, width: boundingRect.width, height: boundingRect.height };
    }

    private updateTreeHelper(
        node: LayoutNode,
        additionalPropsMap: Record<string, LayoutNodeAdditionalProps>,
        leafs: LayoutNode[],
        resizeAction?: LayoutTreeResizeNodeAction
    ) {
        if (!node.children?.length) {
            console.log("adding node to leafs", node);
            leafs.push(node);
            if (this.treeState.magnifiedNodeId === node.id) {
                const boundingRect = this.getBoundingRect();
                const transform = setTransform(
                    {
                        top: boundingRect.height * 0.05,
                        left: boundingRect.width * 0.05,
                        width: boundingRect.width * 0.9,
                        height: boundingRect.height * 0.9,
                    },
                    true
                );
                additionalPropsMap[node.id].transform = transform;
            }
            return;
        }

        function getNodeSize(node: LayoutNode) {
            return resizeAction?.resizeOperations.find((op) => op.nodeId === node.id)?.size ?? node.size;
        }

        const additionalProps: LayoutNodeAdditionalProps = additionalPropsMap.hasOwnProperty(node.id)
            ? additionalPropsMap[node.id]
            : {};

        const nodeRect: Dimensions =
            node.id === this.treeState.rootNode.id ? this.getBoundingRect() : additionalProps.rect;
        const nodeIsRow = node.flexDirection === FlexDirection.Row;
        const nodePixelsMinusGap =
            (nodeIsRow ? nodeRect.width : nodeRect.height) - this.gapSizePx * (node.children.length - 1);
        const totalChildrenSize = node.children.reduce((acc, child) => acc + getNodeSize(child), 0);
        const pixelToSizeRatio = totalChildrenSize / nodePixelsMinusGap;

        let lastChildRect: Dimensions;
        const resizeHandles: ResizeHandleProps[] = [];
        node.children.forEach((child, i) => {
            const childSize = getNodeSize(child);
            const rect: Dimensions = {
                top:
                    !nodeIsRow && lastChildRect
                        ? lastChildRect.top + lastChildRect.height + this.gapSizePx
                        : nodeRect.top,
                left:
                    nodeIsRow && lastChildRect
                        ? lastChildRect.left + lastChildRect.width + this.gapSizePx
                        : nodeRect.left,
                width: nodeIsRow ? childSize / pixelToSizeRatio : nodeRect.width,
                height: nodeIsRow ? nodeRect.height : childSize / pixelToSizeRatio,
            };
            const transform = setTransform(rect);
            additionalPropsMap[child.id] = {
                rect,
                transform,
            };

            const resizeHandleDimensions: Dimensions = {
                top: nodeIsRow ? rect.top : rect.top + rect.height - 0.5 * this.gapSizePx,
                left: nodeIsRow ? rect.left + rect.width - 0.5 * this.gapSizePx : rect.left,
                width: nodeIsRow ? 2 * this.gapSizePx : rect.width,
                height: nodeIsRow ? rect.height : 2 * this.gapSizePx,
            };
            resizeHandles.push({
                id: `${node.id}-${i}`,
                parentNodeId: node.id,
                parentIndex: i,
                transform: setTransform(resizeHandleDimensions, true, false),
                flexDirection: node.flexDirection,
                centerPx: (nodeIsRow ? resizeHandleDimensions.left : resizeHandleDimensions.top) + this.gapSizePx,
            });
            lastChildRect = rect;
        });

        resizeHandles.pop();

        additionalPropsMap[node.id] = {
            ...additionalProps,
            pixelToSizeRatio,
            resizeHandles,
        };
    }

    private getPlaceholderTransform(pendingAction: LayoutTreeAction): CSSProperties {
        if (pendingAction) {
            console.log("pendingAction", pendingAction, this);
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

    magnifyNode(node: LayoutNode) {
        const action = {
            type: LayoutTreeActionType.MagnifyNodeToggle,
            nodeId: node.id,
        };

        this.treeReducer(action);
    }

    async closeNode(node: LayoutNode) {
        const deleteAction: LayoutTreeDeleteNodeAction = {
            type: LayoutTreeActionType.DeleteNode,
            nodeId: node.id,
        };
        this.treeReducer(deleteAction);
        await this.onNodeDelete?.(node.data);
    }

    onContainerResize = () => {
        this.updateTree();
        this.setter(this.isContainerResizing, true);
        this.stopContainerResizing();
    };

    stopContainerResizing = debounce(30, () => {
        this.setter(this.isContainerResizing, false);
    });

    onResizeMove(resizeHandle: ResizeHandleProps, x: number, y: number) {
        console.log("onResizeMove", resizeHandle, x, y, this.resizeContext);
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
        x -= boundingRect?.top;
        y -= boundingRect?.left;

        const clientPoint = parentIsRow ? x : y;
        const clientDiff = (this.resizeContext.resizeHandleStartPx - clientPoint) * this.resizeContext.pixelToSizeRatio;
        const beforeNodeSize = this.resizeContext.beforeNodeStartSize - clientDiff;
        const afterNodeSize = this.resizeContext.afterNodeStartSize + clientDiff;
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

    onResizeEnd() {
        this.resizeContext = undefined;
        this.treeReducer({ type: LayoutTreeActionType.CommitPendingAction });
    }
}
