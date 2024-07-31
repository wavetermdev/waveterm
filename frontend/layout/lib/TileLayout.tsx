// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import useResizeObserver from "@react-hook/resize-observer";
import clsx from "clsx";
import { toPng } from "html-to-image";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import React, {
    CSSProperties,
    ReactNode,
    Suspense,
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { DropTargetMonitor, XYCoord, useDrag, useDragLayer, useDrop } from "react-dnd";
import { debounce, throttle } from "throttle-debounce";
import { useDevicePixelRatio } from "use-device-pixel-ratio";
import { globalLayoutTransformsMap } from "./layoutAtom";
import { findNode, totalChildrenSize } from "./layoutNode";
import { layoutTreeStateReducer } from "./layoutState";
import {
    ContentRenderer,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    PreviewRenderer,
    WritableLayoutTreeStateAtom,
} from "./model";
import { NodeRefMap } from "./nodeRefMap";
import "./tilelayout.less";
import { Dimensions, FlexDirection, determineDropDirection, setTransform } from "./utils";

/**
 * contains callbacks and information about the contents (or styling) of of the TileLayout
 * nothing in here is specific to the TileLayout itself
 */
export interface TileLayoutContents<T> {
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

    /**
     * A callback for getting the cursor point in reference to the current window. This removes Electron as a runtime dependency, allowing for better integration with Storybook.
     * @returns The cursor position relative to the current window.
     */
    getCursorPoint?: () => Point;

    /**
     * tabId this TileLayout is associated with
     */
    tabId?: string;
}

export interface TileLayoutProps<T> {
    /**
     * The atom containing the layout tree state.
     */
    layoutTreeStateAtom: WritableLayoutTreeStateAtom<T>;

    /**
     * callbacks and information about the contents (or styling) of the TileLayout or contents
     */
    contents: TileLayoutContents<T>;

    /**
     * A callback for getting the cursor point in reference to the current window. This removes Electron as a runtime dependency, allowing for better integration with Storybook.
     * @returns The cursor position relative to the current window.
     */
    getCursorPoint?: () => Point;
}

const DragPreviewWidth = 300;
const DragPreviewHeight = 300;

function TileLayoutComponent<T>({ layoutTreeStateAtom, contents, getCursorPoint }: TileLayoutProps<T>) {
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const displayContainerRef = useRef<HTMLDivElement>(null);
    const jotaiStore = useStore();
    const layoutTreeState = useAtomValue(layoutTreeStateAtom);
    const [nodeRefsAtom] = useState<PrimitiveAtom<NodeRefMap>>(atom(new NodeRefMap()));
    const nodeRefs = useAtomValue(nodeRefsAtom);
    const dispatch = useCallback(
        (action: LayoutTreeAction) => {
            const currentState = jotaiStore.get(layoutTreeStateAtom);
            jotaiStore.set(layoutTreeStateAtom, layoutTreeStateReducer(currentState, action));
        },
        [layoutTreeStateAtom, jotaiStore]
    );
    const [showOverlayAtom] = useState<PrimitiveAtom<boolean>>(atom(false));
    const [showOverlay, setShowOverlay] = useAtom(showOverlayAtom);

    function onPointerOver() {
        setShowOverlay(true);
    }

    const [overlayTransform, setOverlayTransform] = useState<CSSProperties>();
    const [layoutLeafTransforms, setLayoutLeafTransformsRaw] = useState<Record<string, CSSProperties>>({});

    const setLayoutLeafTransforms = (transforms: Record<string, CSSProperties>) => {
        globalLayoutTransformsMap.set(contents.tabId, transforms);
        setLayoutLeafTransformsRaw(transforms);
    };

    const { activeDrag, dragClientOffset } = useDragLayer((monitor) => ({
        activeDrag: monitor.isDragging(),
        dragClientOffset: monitor.getClientOffset(),
    }));

    const checkForCursorBounds = useCallback(
        debounce(100, (dragClientOffset: XYCoord) => {
            const cursorPoint = dragClientOffset ?? getCursorPoint?.();
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
        [getCursorPoint, displayContainerRef, dispatch]
    );

    // Effect to detect when the cursor leaves the TileLayout hit trap so we can remove any placeholders. This cannot be done using pointer capture
    // because that conflicts with the DnD layer.
    useEffect(() => checkForCursorBounds(dragClientOffset), [dragClientOffset]);

    /**
     * Callback to update the transforms on the displayed leafs and move the overlay over the display layer when dragging.
     */
    const updateTransforms = useCallback(
        debounce(30, () => {
            // TODO: janky way of preventing updates while a node resize is underway
            if (layoutTreeState.pendingAction?.type === LayoutTreeActionType.ResizeNode) return;
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
                        if (leaf.id === layoutTreeState.magnifiedNodeId) {
                            const transform = setTransform(
                                {
                                    top: displayBoundingRect.height * 0.05,
                                    left: displayBoundingRect.width * 0.05,
                                    width: displayBoundingRect.width * 0.9,
                                    height: displayBoundingRect.height * 0.9,
                                },
                                true
                            );
                            newLayoutLeafTransforms[leaf.id] = transform;
                            continue;
                        }

                        const leafBounding = leafRef.current.getBoundingClientRect();
                        const transform = setTransform({
                            top: leafBounding.top - overlayBoundingRect.top,
                            left: leafBounding.left - overlayBoundingRect.left,
                            width: leafBounding.width,
                            height: leafBounding.height,
                        });
                        newLayoutLeafTransforms[leaf.id] = transform;
                    } else {
                        console.warn("missing leaf", leaf.id);
                    }
                }

                setLayoutLeafTransforms(newLayoutLeafTransforms);

                const newOverlayOffset = displayBoundingRect.top + 2 * displayBoundingRect.height;
                // console.log("overlayOffset", newOverlayOffset);
                setOverlayTransform(
                    setTransform(
                        {
                            top: activeDrag || showOverlay ? 0 : newOverlayOffset,
                            left: 0,
                            width: overlayBoundingRect.width,
                            height: overlayBoundingRect.height,
                        },
                        false
                    )
                );
            }
        }),
        [activeDrag, showOverlay, overlayContainerRef, displayContainerRef, layoutTreeState.leafs, nodeRefs.generation]
    );

    // Update the transforms whenever we drag something and whenever the layout updates.
    useLayoutEffect(() => {
        updateTransforms();
    }, [updateTransforms]);

    useResizeObserver(overlayContainerRef, () => updateTransforms());

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
            await contents.onNodeDelete?.(node.data);
            // console.log("node deleted");
        },
        [contents.onNodeDelete, dispatch]
    );

    const onLeafMagnifyToggle = useCallback(
        (node: LayoutNode<T>) => {
            const action = {
                type: LayoutTreeActionType.MagnifyNodeToggle,
                nodeId: node.id,
            };

            dispatch(action);
        },
        [dispatch]
    );

    return (
        <Suspense>
            <div className={clsx("tile-layout", contents.className, { animate })} onPointerOver={onPointerOver}>
                <div key="display" ref={displayContainerRef} className="display-container">
                    <DisplayNodesWrapper
                        contents={contents}
                        ready={animate}
                        activeDrag={activeDrag}
                        onLeafMagnifyToggle={onLeafMagnifyToggle}
                        onLeafClose={onLeafClose}
                        layoutTreeState={layoutTreeState}
                        layoutLeafTransforms={layoutLeafTransforms}
                    />
                </div>
                <Placeholder
                    key="placeholder"
                    layoutTreeState={layoutTreeState}
                    overlayContainerRef={overlayContainerRef}
                    nodeRefsAtom={nodeRefsAtom}
                    style={{ top: 10000, ...overlayTransform }}
                />
                <div
                    key="overlay"
                    ref={overlayContainerRef}
                    className="overlay-container"
                    style={{ top: 10000, ...overlayTransform }}
                >
                    {!layoutTreeState?.rootNode ? null : (
                        <OverlayNode
                            layoutNode={layoutTreeState.rootNode}
                            layoutTreeState={layoutTreeState}
                            dispatch={dispatch}
                            nodeRefsAtom={nodeRefsAtom}
                            showOverlayAtom={showOverlayAtom}
                            siblingSize={layoutTreeState.rootNode?.size}
                        />
                    )}
                </div>
            </div>
        </Suspense>
    );
}

export const TileLayout = memo(TileLayoutComponent) as typeof TileLayoutComponent;

interface DisplayNodesWrapperProps<T> {
    /**
     * The layout tree state.
     */
    layoutTreeState: LayoutTreeState<T>;
    /**
     * contains callbacks and information about the contents (or styling) of of the TileLayout
     */
    contents: TileLayoutContents<T>;
    /**
     * A callback that is called when a leaf node gets closed.
     * @param node The node that is closed.
     */
    onLeafClose: (node: LayoutNode<T>) => void;

    /**
     * A callback that is called when a leaf's magnification is being toggled.
     * @param node The node that is being magnified or un-magnified.
     */
    onLeafMagnifyToggle: (node: LayoutNode<T>) => void;

    /**
     * A series of CSS properties used to display a leaf node with the correct dimensions and position, as determined from its corresponding OverlayNode.
     */
    layoutLeafTransforms: Record<string, CSSProperties>;
    /**
     * Determines whether the leaf nodes are ready to be displayed to the user.
     */
    ready: boolean;

    /**
     * Determines if a drag operation is in progress.
     */
    activeDrag: boolean;
}

const DisplayNodesWrapper = memo(
    <T,>({
        layoutTreeState,
        contents,
        onLeafClose,
        onLeafMagnifyToggle,
        layoutLeafTransforms,
        ready,
        activeDrag,
    }: DisplayNodesWrapperProps<T>) => {
        if (!layoutLeafTransforms) {
            return null;
        }
        return layoutTreeState.leafs.map((leaf) => {
            return (
                <DisplayNode
                    className={clsx({ magnified: layoutTreeState.magnifiedNodeId === leaf.id })}
                    key={leaf.id}
                    layoutNode={leaf}
                    contents={contents}
                    activeDrag={activeDrag}
                    transform={layoutLeafTransforms[leaf.id]}
                    onLeafClose={onLeafClose}
                    onLeafMagnifyToggle={onLeafMagnifyToggle}
                    ready={ready}
                />
            );
        });
    }
);

interface DisplayNodeProps<T> {
    /**
     * The leaf node object, containing the data needed to display the leaf contents to the user.
     */
    layoutNode: LayoutNode<T>;

    /**
     * contains callbacks and information about the contents (or styling) of of the TileLayout
     */
    contents: TileLayoutContents<T>;

    /**
     * A callback that is called when a leaf's magnification is being toggled.
     * @param node The node that is being magnified or unmagnified.
     */
    onLeafMagnifyToggle: (node: LayoutNode<T>) => void;

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
     * Determines if a drag operation is in progress.
     */
    activeDrag: boolean;

    /**
     * Any class names to add to the component.
     */
    className?: string;

    /**
     * A series of CSS properties used to display a leaf node with the correct dimensions and position, as determined from its corresponding OverlayNode.
     */
    transform: CSSProperties;
}

const dragItemType = "TILE_ITEM";

/**
 * The draggable and displayable portion of a leaf node in a layout tree.
 */
const DisplayNode = memo(
    <T,>({
        layoutNode,
        contents,
        transform,
        onLeafMagnifyToggle,
        onLeafClose,
        ready,
        activeDrag,
        className,
    }: DisplayNodeProps<T>) => {
        const tileNodeRef = useRef<HTMLDivElement>(null);
        const dragHandleRef = useRef<HTMLDivElement>(null);
        const previewRef = useRef<HTMLDivElement>(null);

        const devicePixelRatio = useDevicePixelRatio();

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

        const [previewElementGeneration, setPreviewElementGeneration] = useState(0);
        const previewElement = useMemo(() => {
            setPreviewElementGeneration(previewElementGeneration + 1);
            return (
                <div key="preview" className="tile-preview-container">
                    <div
                        className="tile-preview"
                        ref={previewRef}
                        style={{
                            width: DragPreviewWidth,
                            height: DragPreviewHeight,
                            transform: `scale(${1 / devicePixelRatio})`,
                        }}
                    >
                        {contents.renderPreview?.(layoutNode.data)}
                    </div>
                </div>
            );
        }, [contents.renderPreview, devicePixelRatio]);

        const [previewImage, setPreviewImage] = useState<HTMLImageElement>(null);
        const [previewImageGeneration, setPreviewImageGeneration] = useState(0);
        const generatePreviewImage = useCallback(() => {
            const offsetX = (DragPreviewWidth * devicePixelRatio - DragPreviewWidth) / 2 + 10;
            const offsetY = (DragPreviewHeight * devicePixelRatio - DragPreviewHeight) / 2 + 10;
            if (previewImage !== null && previewElementGeneration === previewImageGeneration) {
                dragPreview(previewImage, { offsetY, offsetX });
            } else if (previewRef.current) {
                setPreviewImageGeneration(previewElementGeneration);
                toPng(previewRef.current).then((url) => {
                    const img = new Image();
                    img.src = url;
                    setPreviewImage(img);
                    dragPreview(img, { offsetY, offsetX });
                });
            }
        }, [
            dragPreview,
            previewRef.current,
            previewElementGeneration,
            previewImageGeneration,
            previewImage,
            devicePixelRatio,
        ]);

        // Register the tile item as a draggable component
        useEffect(() => {
            drag(dragHandleRef);
        }, [drag, dragHandleRef.current]);

        const onClose = useCallback(() => {
            onLeafClose(layoutNode);
        }, [layoutNode, onLeafClose]);

        const onMagnifyToggle = useCallback(() => {
            onLeafMagnifyToggle(layoutNode);
        }, [layoutNode, onLeafMagnifyToggle]);

        const leafContent = useMemo(() => {
            return (
                layoutNode.data && (
                    <div key="leaf" className="tile-leaf">
                        {contents.renderContent(
                            layoutNode.data,
                            ready,
                            activeDrag,
                            onMagnifyToggle,
                            onClose,
                            dragHandleRef
                        )}
                    </div>
                )
            );
        }, [layoutNode.data, ready, activeDrag, onClose]);

        return (
            <div
                className={clsx("tile-node", className, { dragging: isDragging })}
                ref={tileNodeRef}
                id={layoutNode.id}
                style={{
                    ...transform,
                }}
                onPointerEnter={generatePreviewImage}
                onPointerOver={(event) => event.stopPropagation()}
            >
                {leafContent}
                {previewElement}
            </div>
        );
    }
);

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

    nodeRefsAtom: PrimitiveAtom<NodeRefMap>;

    showOverlayAtom: PrimitiveAtom<boolean>;

    showResizeOverlay?: boolean;

    siblingSize: number;
}

/**
 * An overlay representing the true flexbox layout of the LayoutTreeState. This holds the drop targets for moving around nodes and is used to calculate the
 * dimensions of the corresponding DisplayNode for each LayoutTreeState leaf.
 */
const OverlayNode = <T,>({
    layoutNode,
    layoutTreeState,
    dispatch,
    nodeRefsAtom,
    showOverlayAtom,
    showResizeOverlay,
    siblingSize,
}: OverlayNodeProps<T>) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const leafRef = useRef<HTMLDivElement>(null);

    const setShowOverlay = useSetAtom(showOverlayAtom);

    const setNodeRefs = useSetAtom(nodeRefsAtom);

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
            setNodeRefs((nodeRefs) => {
                nodeRefs.set(layoutNodeId, overlayRef);
                return nodeRefs;
            });
        }

        return () => {
            setNodeRefs((nodeRefs) => {
                nodeRefs.delete(layoutNodeId);
                return nodeRefs;
            });
        };
    }, [overlayRef, layoutNode?.id]);

    function onPointerOverLeaf(event: React.PointerEvent<HTMLDivElement>) {
        event.stopPropagation();
        setShowOverlay(false);
    }

    const [resizeOnCurrentNode, setResizeOnCurrentNode] = useState(false);
    const [pendingSize, setPendingSize] = useState<number>(undefined);

    useLayoutEffect(() => {
        if (showResizeOverlay) {
            setResizeOnCurrentNode(false);
            setPendingSize(undefined);
            return;
        }
        if (layoutTreeState.pendingAction?.type === LayoutTreeActionType.ResizeNode) {
            const resizeAction = layoutTreeState.pendingAction as LayoutTreeResizeNodeAction;
            const resizeOperation = resizeAction?.resizeOperations?.find(
                (operation) => operation.nodeId === layoutNode.id
            );
            if (resizeOperation) {
                setResizeOnCurrentNode(true);
                setPendingSize(resizeOperation.size);
                return;
            }
        }
        setResizeOnCurrentNode(false);
        setPendingSize(undefined);
    }, [showResizeOverlay, layoutTreeState.pendingAction]);

    const generateChildren = () => {
        if (Array.isArray(layoutNode.children)) {
            const totalSize = totalChildrenSize(layoutNode);
            return layoutNode.children
                .map((childItem, i) => {
                    return [
                        <OverlayNode
                            key={childItem.id}
                            layoutNode={childItem}
                            layoutTreeState={layoutTreeState}
                            dispatch={dispatch}
                            nodeRefsAtom={nodeRefsAtom}
                            showOverlayAtom={showOverlayAtom}
                            showResizeOverlay={resizeOnCurrentNode || showResizeOverlay}
                            siblingSize={totalSize}
                        />,
                        <ResizeHandle
                            key={`resize-${layoutNode.id}-${i}`}
                            parentNode={layoutNode}
                            index={i}
                            dispatch={dispatch}
                            nodeRefsAtom={nodeRefsAtom}
                        />,
                    ];
                })
                .flat()
                .slice(0, -1);
        } else {
            return [<div ref={leafRef} key="leaf" className="overlay-leaf" onPointerOver={onPointerOverLeaf}></div>];
        }
    };

    if (!layoutNode) {
        return null;
    }

    const sizePercentage = ((pendingSize ?? layoutNode.size) / siblingSize) * 100;

    return (
        <div
            ref={overlayRef}
            className={clsx("overlay-node", { resizing: resizeOnCurrentNode || showResizeOverlay })}
            id={layoutNode.id}
            style={{
                flexBasis: `${sizePercentage.toPrecision(5)}%`,
                flexDirection: layoutNode.flexDirection,
            }}
        >
            {generateChildren()}
        </div>
    );
};

interface ResizeHandleProps<T> {
    parentNode: LayoutNode<T>;
    index: number;
    dispatch: (action: LayoutTreeAction) => void;
    nodeRefsAtom: PrimitiveAtom<NodeRefMap>;
}

const ResizeHandle = <T,>({ parentNode, index, dispatch, nodeRefsAtom }: ResizeHandleProps<T>) => {
    const resizeHandleRef = useRef<HTMLDivElement>(null);

    // The pointer currently captured, or undefined.
    const [trackingPointer, setTrackingPointer] = useState<number>(undefined);
    const nodeRefs = useAtomValue(nodeRefsAtom);

    // Cached values set in startResize
    const [combinedNodesRect, setCombinedNodesRect] = useState<Dimensions>();
    const [gapSize, setGapSize] = useState(0);
    const [pixelToSizeRatio, setPixelToSizeRatio] = useState(0);

    // Precompute some values that will be needed by the handlePointerMove function
    const startResize = () => {
        const parentRef = nodeRefs.get(parentNode.id);
        const node1Ref = nodeRefs.get(parentNode.children![index].id);
        const node2Ref = nodeRefs.get(parentNode.children![index + 1].id);
        if (parentRef?.current && node1Ref?.current && node2Ref?.current) {
            const parentIsRow = parentNode.flexDirection === FlexDirection.Row;
            const parentRectNew = parentRef.current.getBoundingClientRect();
            const node1Rect = node1Ref.current.getBoundingClientRect();
            const node2Rect = node2Ref.current.getBoundingClientRect();
            const totalSiblingSize = totalChildrenSize(parentNode);
            const gapSize = parentIsRow
                ? node2Rect.left - (node1Rect.left + node1Rect.width)
                : node2Rect.top - (node1Rect.top + node1Rect.height);
            setGapSize(gapSize);
            const parentPixelsMinusGap =
                (parentIsRow ? parentRectNew.width : parentRectNew.height) -
                (gapSize * parentNode.children!.length - 1);
            const newPixelToSizeRatio = totalSiblingSize / parentPixelsMinusGap;
            // console.log("newPixelToSizeRatio", newPixelToSizeRatio, siblingSize, parentPixelsMinusGap);
            setPixelToSizeRatio(newPixelToSizeRatio);
            const newCombinedNodesRect: Dimensions = {
                top: node1Rect.top,
                left: node1Rect.left,
                height: parentIsRow ? node1Rect.height : node1Rect.height + node2Rect.height + gapSize,
                width: parentIsRow ? node1Rect.width + node2Rect.width + gapSize : node1Rect.width,
            };
            setCombinedNodesRect(newCombinedNodesRect);
            // console.log(
            //     "startResize",
            //     parentNode,
            //     index,
            //     parentIsRow,
            //     gapSize,
            //     parentRectNew,
            //     node1Rect,
            //     node2Rect,
            //     newCombinedNodesRect,
            //     newPixelToSizeRatio
            // );
        }
    };

    // Calculates the new size of the two nodes on either side of the handle, based on the position of the cursor
    const handlePointerMove = useCallback(
        throttle(10, (event: React.PointerEvent<HTMLDivElement>) => {
            if (trackingPointer === event.pointerId) {
                const { clientX, clientY } = event;
                // console.log("handlePointerMove", [clientX, clientY], combinedNodesRect, pixelToSizeRatio);
                const parentIsRow = parentNode.flexDirection === FlexDirection.Row;
                const combinedStart = parentIsRow ? combinedNodesRect.left : combinedNodesRect.top;
                const combinedEnd = parentIsRow
                    ? combinedNodesRect.left + combinedNodesRect.width
                    : combinedNodesRect.top + combinedNodesRect.height;
                const clientPoint = parentIsRow ? clientX : clientY;
                // console.log("handlePointerMove", parentNode, index, clientX, clientY, parentRect, combinedNodesRect);
                if (clientPoint > combinedStart + 10 && clientPoint < combinedEnd - 10) {
                    const halfGap = gapSize / 2;
                    const sizeNode1 = clientPoint - combinedStart - halfGap;
                    const sizeNode2 = combinedEnd - clientPoint + halfGap;
                    const resizeAction: LayoutTreeResizeNodeAction = {
                        type: LayoutTreeActionType.ResizeNode,
                        resizeOperations: [
                            {
                                nodeId: parentNode.children![index].id,
                                size: parseFloat((sizeNode1 * pixelToSizeRatio).toPrecision(5)),
                            },
                            {
                                nodeId: parentNode.children![index + 1].id,
                                size: parseFloat((sizeNode2 * pixelToSizeRatio).toPrecision(5)),
                            },
                        ],
                    };
                    const setPendingAction: LayoutTreeSetPendingAction = {
                        type: LayoutTreeActionType.SetPendingAction,
                        action: resizeAction,
                    };

                    dispatch(setPendingAction);
                }
            }
        }),
        [parentNode, trackingPointer, dispatch, gapSize, combinedNodesRect, pixelToSizeRatio, index]
    );

    // We want to use pointer capture so the operation continues even if the pointer leaves the bounds of the handle
    function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        resizeHandleRef.current?.setPointerCapture(event.pointerId);
        startResize();
    }

    // This indicates that we're ready to start tracking the resize operation via the pointer
    function onPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
        setTrackingPointer(event.pointerId);
    }

    // We want to wait a bit before committing the pending resize operation in case some events haven't arrived yet.
    const onPointerRelease = useCallback(
        debounce(30, (event: React.PointerEvent<HTMLDivElement>) => {
            setTrackingPointer(undefined);
            dispatch({ type: LayoutTreeActionType.CommitPendingAction });
        }),
        [dispatch]
    );

    // Don't render if we are dealing with the last child of a parent
    if (index + 1 >= parentNode.children!.length) {
        return;
    }

    return (
        <div
            ref={resizeHandleRef}
            className={clsx("resize-handle", `flex-${parentNode.flexDirection}`)}
            onPointerDown={onPointerDown}
            onGotPointerCapture={onPointerCapture}
            onLostPointerCapture={onPointerRelease}
            onPointerMove={handlePointerMove}
        >
            <div className="line" />
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
    nodeRefsAtom: PrimitiveAtom<NodeRefMap>;
    /**
     * Any styling to apply to the placeholder container div.
     */
    style: React.CSSProperties;
}

/**
 * An overlay to preview pending actions on the layout tree.
 */
const Placeholder = memo(<T,>({ layoutTreeState, overlayContainerRef, nodeRefsAtom, style }: PlaceholderProps<T>) => {
    const [placeholderOverlay, setPlaceholderOverlay] = useState<ReactNode>(null);

    const nodeRefs = useAtomValue(nodeRefsAtom);

    const updatePlaceholder = useCallback(
        throttle(10, (pendingAction: LayoutTreeAction) => {
            let newPlaceholderOverlay: ReactNode;
            if (overlayContainerRef?.current) {
                switch (pendingAction?.type) {
                    case LayoutTreeActionType.Move: {
                        const action = pendingAction as LayoutTreeMoveNodeAction<T>;
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
                                            parentNode.flexDirection === FlexDirection.Row &&
                                            targetBoundingRect.width / 2;
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

                                const placeholderTransform = setTransform(placeholderDimensions);
                                newPlaceholderOverlay = (
                                    <div className="placeholder" style={{ ...placeholderTransform }} />
                                );
                            }
                        }
                        break;
                    }
                    case LayoutTreeActionType.Swap: {
                        const action = pendingAction as LayoutTreeSwapNodeAction;
                        // console.log("placeholder for swap", action);
                        const targetNodeId = action.node1Id;
                        const targetRef = nodeRefs.get(targetNodeId);
                        if (targetRef?.current) {
                            const overlayBoundingRect = overlayContainerRef.current.getBoundingClientRect();
                            const targetBoundingRect = targetRef.current.getBoundingClientRect();
                            const placeholderDimensions: Dimensions = {
                                top: targetBoundingRect.top - overlayBoundingRect.top,
                                left: targetBoundingRect.left - overlayBoundingRect.left,
                                height: targetBoundingRect.height,
                                width: targetBoundingRect.width,
                            };

                            const placeholderTransform = setTransform(placeholderDimensions);
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
        }),
        [nodeRefs, overlayContainerRef, layoutTreeState.rootNode]
    );

    useEffect(() => {
        updatePlaceholder(layoutTreeState.pendingAction);
    }, [layoutTreeState.pendingAction, updatePlaceholder]);

    return (
        <div className="placeholder-container" style={style}>
            {placeholderOverlay}
        </div>
    );
});
