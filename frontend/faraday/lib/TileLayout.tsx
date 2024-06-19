// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import useResizeObserver from "@react-hook/resize-observer";
import clsx from "clsx";
import { toPng } from "html-to-image";
import React, {
    CSSProperties,
    ReactNode,
    RefObject,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { DropTargetMonitor, useDrag, useDragLayer, useDrop } from "react-dnd";
import { debounce, throttle } from "throttle-debounce";
import { useLayoutTreeStateReducerAtom } from "./layoutAtom";
import { findNode } from "./layoutNode";
import {
    ContentRenderer,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    PreviewRenderer,
    WritableLayoutTreeStateAtom,
} from "./model";
import "./tilelayout.less";
import { Dimensions, FlexDirection, setTransform as createTransform, determineDropDirection } from "./utils";

export interface TileLayoutProps<T> {
    /**
     * The atom containing the layout tree state.
     */
    layoutTreeStateAtom: WritableLayoutTreeStateAtom<T>;
    /**
     * A callback that accepts the data from the leaf node and displays the leaf contents to the user.
     */
    renderContent: ContentRenderer<T>;
    /**
     * A callback that accepts the data from the leaf node and returns a preview that can be shown when the user drags a node.
     */
    renderPreview?: PreviewRenderer<T>;
    /**
     * A callback that is called when a node gets deleted from the LayoutTreeState.
     * @param data The contents of the node that was deleted.
     */
    onNodeDelete?: (data: T) => Promise<void>;
    /**
     * The class name to use for the top-level div of the tile layout.
     */
    className?: string;
}

const DragPreviewWidth = 300;
const DragPreviewHeight = 300;

export const TileLayout = <T,>({
    layoutTreeStateAtom,
    className,
    renderContent,
    renderPreview,
    onNodeDelete,
}: TileLayoutProps<T>) => {
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const displayContainerRef = useRef<HTMLDivElement>(null);

    const [layoutTreeState, dispatch] = useLayoutTreeStateReducerAtom(layoutTreeStateAtom);
    const [nodeRefs, setNodeRefs] = useState<Map<string, RefObject<HTMLDivElement>>>(new Map());
    const [nodeRefsGen, setNodeRefsGen] = useState<number>(0);

    // useEffect(() => {
    //     console.log("layoutTreeState changed", layoutTreeState);
    // }, [layoutTreeState]);

    const setRef = useCallback(
        (id: string, ref: RefObject<HTMLDivElement>) => {
            setNodeRefs((prev) => {
                // console.log("setRef", id, ref);
                prev.set(id, ref);
                return prev;
            });
            setNodeRefsGen((prev) => prev + 1);
        },
        [setNodeRefs]
    );

    const deleteRef = useCallback(
        (id: string) => {
            // console.log("deleteRef", id);
            if (nodeRefs.has(id)) {
                setNodeRefs((prev) => {
                    prev.delete(id);
                    return prev;
                });
                setNodeRefsGen((prev) => prev + 1);
            } else {
                console.log("deleteRef id not found", id);
            }
        },
        [nodeRefs, setNodeRefs]
    );
    const [overlayTransform, setOverlayTransform] = useState<CSSProperties>();
    const [layoutLeafTransforms, setLayoutLeafTransforms] = useState<Record<string, CSSProperties>>({});

    const { activeDrag, dragClientOffset } = useDragLayer((monitor) => ({
        activeDrag: monitor.isDragging(),
        dragClientOffset: monitor.getClientOffset(),
    }));

    // Effect to detect when the cursor leaves the TileLayout hit trap so we can remove any placeholders. This cannot be done using pointer capture
    // because that conflicts with the DnD layer.
    useEffect(
        debounce(100, () => {
            const cursorPoint = getApi().getCursorPoint();
            if (cursorPoint && displayContainerRef.current) {
                const displayContainerRect = displayContainerRef.current.getBoundingClientRect();
                const normalizedX = cursorPoint.x - displayContainerRect.x;
                const normalizedY = cursorPoint.y - displayContainerRect.y;
                if (
                    normalizedX <= 0 ||
                    normalizedX >= displayContainerRect.width ||
                    normalizedY <= 0 ||
                    normalizedY >= displayContainerRect.height
                ) {
                    dispatch({ type: LayoutTreeActionType.ClearPendingAction });
                }
            }
        }),
        [dragClientOffset]
    );

    /**
     * Callback to update the transforms on the displayed leafs and move the overlay over the display layer when dragging.
     */
    const updateTransforms = useCallback(
        debounce(30, () => {
            if (overlayContainerRef.current && displayContainerRef.current) {
                const displayBoundingRect = displayContainerRef.current.getBoundingClientRect();
                // console.log("displayBoundingRect", displayBoundingRect);
                const overlayBoundingRect = overlayContainerRef.current.getBoundingClientRect();

                const newLayoutLeafTransforms: Record<string, CSSProperties> = {};

                // console.log(
                //     "nodeRefs",
                //     nodeRefs,
                //     "layoutLeafs",
                //     layoutTreeState.leafs,
                //     "layoutTreeState",
                //     layoutTreeState
                // );

                for (const leaf of layoutTreeState.leafs) {
                    const leafRef = nodeRefs.get(leaf.id);
                    // console.log("current leafRef", leafRef.current);
                    if (leafRef?.current) {
                        const leafBounding = leafRef.current.getBoundingClientRect();
                        const transform = createTransform({
                            top: leafBounding.top - overlayBoundingRect.top,
                            left: leafBounding.left - overlayBoundingRect.left,
                            width: leafBounding.width,
                            height: leafBounding.height,
                        });
                        newLayoutLeafTransforms[leafRef.current.id] = transform;
                    } else {
                        console.warn("missing leaf", leaf.id);
                    }
                }

                setLayoutLeafTransforms(newLayoutLeafTransforms);

                const newOverlayOffset = displayBoundingRect.top + 2 * displayBoundingRect.height;
                // console.log("overlayOffset", newOverlayOffset);
                setOverlayTransform(
                    createTransform(
                        {
                            top: activeDrag ? 0 : newOverlayOffset,
                            left: 0,
                            width: overlayBoundingRect.width,
                            height: overlayBoundingRect.height,
                        },
                        false
                    )
                );
            }
        }),
        [activeDrag, overlayContainerRef, displayContainerRef, layoutTreeState.leafs, nodeRefsGen]
    );

    // Update the transforms whenever we drag something and whenever the layout updates.
    useLayoutEffect(() => {
        updateTransforms();
    }, [updateTransforms]);

    useResizeObserver(overlayContainerRef, () => updateTransforms());

    const onPointerLeave = useCallback(() => {
        if (activeDrag) {
            dispatch({ type: LayoutTreeActionType.ClearPendingAction });
        }
    }, [activeDrag, dispatch]);

    // Ensure that we don't see any jostling in the layout when we're rendering it the first time.
    // `animate` will be disabled until after the transforms have all applied the first time.
    const [animate, setAnimate] = useState(false);
    useEffect(() => {
        setTimeout(() => {
            setAnimate(true);
        }, 50);
    }, []);

    const onLeafClose = useCallback(
        async (node: LayoutNode<T>) => {
            // console.log("onLeafClose", node);
            const deleteAction: LayoutTreeDeleteNodeAction = {
                type: LayoutTreeActionType.DeleteNode,
                nodeId: node.id,
            };
            // console.log("calling dispatch", deleteAction);
            dispatch(deleteAction);
            // console.log("calling onNodeDelete", node);
            await onNodeDelete?.(node.data);
            // console.log("node deleted");
        },
        [onNodeDelete, dispatch]
    );

    return (
        <Suspense>
            <div className={clsx("tile-layout", className, { animate })} onPointerOut={onPointerLeave}>
                <div key="display" ref={displayContainerRef} className="display-container">
                    {layoutLeafTransforms &&
                        layoutTreeState.leafs.map((leaf) => {
                            return (
                                <DisplayNode
                                    key={leaf.id}
                                    layoutNode={leaf}
                                    renderContent={renderContent}
                                    renderPreview={renderPreview}
                                    transform={layoutLeafTransforms[leaf.id]}
                                    onLeafClose={onLeafClose}
                                    ready={animate}
                                />
                            );
                        })}
                </div>
                <Placeholder
                    key="placeholder"
                    layoutTreeState={layoutTreeState}
                    overlayContainerRef={overlayContainerRef}
                    nodeRefs={nodeRefs}
                    style={{ top: 10000, ...overlayTransform }}
                />
                <div
                    key="overlay"
                    ref={overlayContainerRef}
                    className="overlay-container"
                    style={{ top: 10000, ...overlayTransform }}
                >
                    <OverlayNode
                        layoutNode={layoutTreeState.rootNode}
                        layoutTreeState={layoutTreeState}
                        dispatch={dispatch}
                        setRef={setRef}
                        deleteRef={deleteRef}
                    />
                </div>
            </div>
        </Suspense>
    );
};

interface DisplayNodeProps<T> {
    /**
     * The leaf node object, containing the data needed to display the leaf contents to the user.
     */
    layoutNode: LayoutNode<T>;
    /**
     * A callback that accepts the data from the leaf node and displays the leaf contents to the user.
     */
    renderContent: ContentRenderer<T>;
    /**
     * A callback that accepts the data from the leaf node and returns a preview that can be shown when the user drags a node.
     */
    renderPreview?: PreviewRenderer<T>;
    /**
     * A callback that is called when a leaf node gets closed.
     * @param node The node that is closed.
     */
    onLeafClose: (node: LayoutNode<T>) => void;
    /**
     * Determines whether a leaf's contents should be displayed to the user.
     */
    ready: boolean;
    /**
     * A series of CSS properties used to display a leaf node with the correct dimensions and position, as determined from its corresponding OverlayNode.
     */
    transform: CSSProperties;
}

const dragItemType = "TILE_ITEM";

/**
 * The draggable and displayable portion of a leaf node in a layout tree.
 */
const DisplayNode = <T,>({
    layoutNode,
    renderContent,
    renderPreview,
    transform,
    onLeafClose,
    ready,
}: DisplayNodeProps<T>) => {
    const tileNodeRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const hasImagePreviewSetRef = useRef(false);

    // Register the node as a draggable item.
    const [{ isDragging }, drag, dragPreview] = useDrag(
        () => ({
            type: dragItemType,
            item: () => layoutNode,
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        }),
        [layoutNode]
    );

    const previewElement = renderPreview?.(layoutNode.data);
    const previewWidth = DragPreviewWidth;
    const previewHeight = DragPreviewHeight;
    const previewTransform = `scale(${1 / window.devicePixelRatio})`;
    const [previewImage, setPreviewImage] = useState<HTMLImageElement>(null);
    // we set the drag preview on load to be the HTML element
    // later, on pointerenter, we generate a static png preview to use instead (for performance)
    useEffect(() => {
        if (!hasImagePreviewSetRef.current) {
            dragPreview(previewRef.current);
        }
    }, []);
    const generatePreviewImage = useCallback(() => {
        let offsetX = (DragPreviewWidth * window.devicePixelRatio - DragPreviewWidth) / 2 + 10;
        let offsetY = (DragPreviewHeight * window.devicePixelRatio - DragPreviewHeight) / 2 + 10;
        if (previewImage != null) {
            dragPreview(previewImage, { offsetY, offsetX });
        } else if (previewRef.current) {
            toPng(previewRef.current).then((url) => {
                const img = new Image();
                img.src = url;
                img.onload = () => {
                    hasImagePreviewSetRef.current = true;
                    setPreviewImage(img);
                    dragPreview(img, { offsetY, offsetX });
                };
            });
        }
    }, [previewRef, previewImage, dragPreview]);

    // Register the tile item as a draggable component
    useEffect(() => {
        drag(tileNodeRef);
    }, [tileNodeRef]);

    const onClose = useCallback(() => {
        onLeafClose(layoutNode);
    }, [layoutNode, onLeafClose]);

    const leafContent = useMemo(() => {
        return (
            layoutNode.data && (
                <div key="leaf" className="tile-leaf">
                    {renderContent(layoutNode.data, ready, onClose)}
                </div>
            )
        );
    }, [layoutNode.data, ready, onClose]);

    return (
        <div
            className={clsx("tile-node", { dragging: isDragging })}
            ref={tileNodeRef}
            id={layoutNode.id}
            style={{
                flexDirection: layoutNode.flexDirection,
                flexBasis: layoutNode.size,
                ...transform,
            }}
            onPointerEnter={generatePreviewImage}
        >
            {leafContent}
            <div key="preview" className="tile-preview-container">
                <div
                    className="tile-preview"
                    ref={previewRef}
                    style={{
                        width: previewWidth,
                        height: previewHeight,
                        transform: previewTransform,
                    }}
                >
                    {previewElement}
                </div>
            </div>
        </div>
    );
};

interface OverlayNodeProps<T> {
    /**
     * The layout node object corresponding to the OverlayNode.
     */
    layoutNode: LayoutNode<T>;
    /**
     * The layout tree state.
     */
    layoutTreeState: LayoutTreeState<T>;
    /**
     * The reducer function for mutating the layout tree state.
     * @param action The action to perform.
     */
    dispatch: (action: LayoutTreeAction) => void;
    /**
     * A callback to update the RefObject mapping corresponding to the layout node. Used to inform the TileLayout of changes to the OverlayNode's position and size.
     * @param id The id of the layout node being mounted.
     * @param ref The reference to the mounted overlay node.
     */
    setRef: (id: string, ref: RefObject<HTMLDivElement>) => void;
    /**
     * A callback to remove the RefObject mapping corresponding to the layout node when it gets unmounted.
     * @param id The id of the layout node being unmounted.
     */
    deleteRef: (id: string) => void;
}

/**
 * An overlay representing the true flexbox layout of the LayoutTreeState. This holds the drop targets for moving around nodes and is used to calculate the
 * dimensions of the corresponding DisplayNode for each LayoutTreeState leaf.
 */
const OverlayNode = <T,>({ layoutNode, layoutTreeState, dispatch, setRef, deleteRef }: OverlayNodeProps<T>) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const leafRef = useRef<HTMLDivElement>(null);

    const [, drop] = useDrop(
        () => ({
            accept: dragItemType,
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<LayoutNode<T>>();
                if (monitor.isOver({ shallow: true }) && dragItem?.id !== layoutNode.id) {
                    return true;
                }
                return false;
            },
            drop: (_, monitor) => {
                // console.log("drop start", layoutNode.id, layoutTreeState.pendingAction);
                if (!monitor.didDrop() && layoutTreeState.pendingAction) {
                    dispatch({
                        type: LayoutTreeActionType.CommitPendingAction,
                    });
                }
            },
            hover: throttle(30, (_, monitor: DropTargetMonitor<unknown, unknown>) => {
                if (monitor.isOver({ shallow: true })) {
                    if (monitor.canDrop()) {
                        const dragItem = monitor.getItem<LayoutNode<T>>();
                        // console.log("computing operation", layoutNode, dragItem, layoutTreeState.pendingAction);
                        dispatch({
                            type: LayoutTreeActionType.ComputeMove,
                            node: layoutNode,
                            nodeToMove: dragItem,
                            direction: determineDropDirection(
                                overlayRef.current?.getBoundingClientRect(),
                                monitor.getClientOffset()
                            ),
                        } as LayoutTreeComputeMoveNodeAction<T>);
                    } else {
                        dispatch({
                            type: LayoutTreeActionType.ClearPendingAction,
                        });
                    }
                }
            }),
        }),
        [overlayRef.current, layoutNode, layoutTreeState, dispatch]
    );

    // Register the tile item as a draggable component
    useEffect(() => {
        const layoutNodeId = layoutNode?.id;
        if (overlayRef?.current) {
            drop(overlayRef);
            setRef(layoutNodeId, overlayRef);
        }

        return () => {
            deleteRef(layoutNodeId);
        };
    }, [overlayRef]);

    const generateChildren = () => {
        if (Array.isArray(layoutNode.children)) {
            return layoutNode.children.map((childItem) => {
                return (
                    <OverlayNode
                        key={childItem.id}
                        layoutNode={childItem}
                        layoutTreeState={layoutTreeState}
                        dispatch={dispatch}
                        setRef={setRef}
                        deleteRef={deleteRef}
                    />
                );
            });
        } else {
            return [<div ref={leafRef} key="leaf" className="overlay-leaf"></div>];
        }
    };

    if (!layoutNode) {
        return null;
    }

    return (
        <div
            ref={overlayRef}
            className="overlay-node"
            id={layoutNode.id}
            style={{
                flexBasis: layoutNode.size,
                flexDirection: layoutNode.flexDirection,
            }}
        >
            {generateChildren()}
        </div>
    );
};

interface PlaceholderProps<T> {
    /**
     * The layout tree state.
     */
    layoutTreeState: LayoutTreeState<T>;
    /**
     * A reference to the div containing the overlay nodes. Used to normalize the position of the target node as the overlay container is moved in and out of view.
     */
    overlayContainerRef: React.RefObject<HTMLElement>;
    /**
     * The mapping of all layout nodes to their corresponding mounted overlay node.
     */
    nodeRefs: Map<string, React.RefObject<HTMLElement>>;
    /**
     * Any styling to apply to the placeholder container div.
     */
    style: React.CSSProperties;
}

/**
 * An overlay to preview pending actions on the layout tree.
 */
const Placeholder = <T,>({ layoutTreeState, overlayContainerRef, nodeRefs, style }: PlaceholderProps<T>) => {
    const [placeholderOverlay, setPlaceholderOverlay] = useState<ReactNode>(null);

    useEffect(() => {
        let newPlaceholderOverlay: ReactNode;
        if (overlayContainerRef?.current) {
            switch (layoutTreeState?.pendingAction?.type) {
                case LayoutTreeActionType.Move: {
                    const action = layoutTreeState.pendingAction as LayoutTreeMoveNodeAction<T>;
                    let parentId: string;
                    if (action.insertAtRoot) {
                        parentId = layoutTreeState.rootNode.id;
                    } else {
                        parentId = action.parentId;
                    }

                    const parentNode = findNode(layoutTreeState.rootNode, parentId);
                    if (action.index !== undefined && parentNode) {
                        const targetIndex = Math.min(
                            parentNode.children ? parentNode.children.length - 1 : 0,
                            Math.max(0, action.index - 1)
                        );
                        let targetNode = parentNode?.children?.at(targetIndex);
                        let targetRef: React.RefObject<HTMLElement>;
                        if (targetNode) {
                            targetRef = nodeRefs.get(targetNode.id);
                        } else {
                            targetRef = nodeRefs.get(parentNode.id);
                            targetNode = parentNode;
                        }
                        if (targetRef?.current) {
                            const overlayBoundingRect = overlayContainerRef.current.getBoundingClientRect();
                            const targetBoundingRect = targetRef.current.getBoundingClientRect();

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
                                top: targetBoundingRect.top - overlayBoundingRect.top,
                                left: targetBoundingRect.left - overlayBoundingRect.left,
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

                            const placeholderTransform = createTransform(placeholderDimensions);
                            newPlaceholderOverlay = <div className="placeholder" style={{ ...placeholderTransform }} />;
                        }
                    }
                    break;
                }
                case LayoutTreeActionType.Swap: {
                    const action = layoutTreeState.pendingAction as LayoutTreeSwapNodeAction<T>;
                    // console.log("placeholder for swap", action);
                    const targetNode = action.node1;
                    const targetRef = nodeRefs.get(targetNode?.id);
                    if (targetRef?.current) {
                        const overlayBoundingRect = overlayContainerRef.current.getBoundingClientRect();
                        const targetBoundingRect = targetRef.current.getBoundingClientRect();
                        const placeholderDimensions: Dimensions = {
                            top: targetBoundingRect.top - overlayBoundingRect.top,
                            left: targetBoundingRect.left - overlayBoundingRect.left,
                            height: targetBoundingRect.height,
                            width: targetBoundingRect.width,
                        };

                        const placeholderTransform = createTransform(placeholderDimensions);
                        newPlaceholderOverlay = <div className="placeholder" style={{ ...placeholderTransform }} />;
                    }
                    break;
                }
                default:
                    // No-op
                    break;
            }
        }
        setPlaceholderOverlay(newPlaceholderOverlay);
    }, [layoutTreeState, nodeRefs, overlayContainerRef]);

    return (
        <div className="placeholder-container" style={style}>
            {placeholderOverlay}
        </div>
    );
};
