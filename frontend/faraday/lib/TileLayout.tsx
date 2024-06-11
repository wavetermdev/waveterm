// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import {
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
import { useDrag, useDragLayer, useDrop } from "react-dnd";

import useResizeObserver from "@react-hook/resize-observer";
import { toPng } from "html-to-image";
import { useLayoutTreeStateReducerAtom } from "./layoutAtom.js";
import { findNode } from "./layoutNode.js";
import {
    ContentRenderer,
    LayoutNode,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeState,
    PreviewRenderer,
    WritableLayoutTreeStateAtom,
} from "./model.js";
import "./tilelayout.less";
import {
    Dimensions,
    FlexDirection,
    setTransform as createTransform,
    debounce,
    determineDropDirection,
} from "./utils.js";

export interface TileLayoutProps<T> {
    layoutTreeStateAtom: WritableLayoutTreeStateAtom<T>;
    renderContent: ContentRenderer<T>;
    renderPreview?: PreviewRenderer<T>;
    onNodeDelete?: (data: T) => Promise<void>;
    className?: string;
}

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

    useEffect(() => {
        console.log("layoutTreeState changed", layoutTreeState);
    }, [layoutTreeState]);

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

    const activeDrag = useDragLayer((monitor) => monitor.isDragging());

    /**
     * Callback to update the transforms on the displayed leafs and move the overlay over the display layer when dragging.
     */
    const updateTransforms = useCallback(
        debounce(() => {
            if (overlayContainerRef.current && displayContainerRef.current) {
                const displayBoundingRect = displayContainerRef.current.getBoundingClientRect();
                console.log("displayBoundingRect", displayBoundingRect);
                const overlayBoundingRect = overlayContainerRef.current.getBoundingClientRect();

                const newLayoutLeafTransforms: Record<string, CSSProperties> = {};

                console.log(
                    "nodeRefs",
                    nodeRefs,
                    "layoutLeafs",
                    layoutTreeState.leafs,
                    "layoutTreeState",
                    layoutTreeState
                );

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
                console.log("overlayOffset", newOverlayOffset);
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
        }, 30),
        [activeDrag, overlayContainerRef, displayContainerRef, layoutTreeState.leafs, nodeRefsGen]
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
            console.log("onLeafClose", node);
            const deleteAction: LayoutTreeDeleteNodeAction = {
                type: LayoutTreeActionType.DeleteNode,
                nodeId: node.id,
            };
            console.log("calling dispatch", deleteAction);
            dispatch(deleteAction);
            console.log("calling onNodeDelete", node);
            await onNodeDelete?.(node.data);
            console.log("node deleted");
        },
        [onNodeDelete, dispatch]
    );

    return (
        <Suspense>
            <div className={clsx("tile-layout", className, { animate })}>
                <div key="display" ref={displayContainerRef} className="display-container">
                    {layoutLeafTransforms &&
                        layoutTreeState.leafs.map((leaf) => {
                            return (
                                <TileNode
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

interface TileNodeProps<T> {
    layoutNode: LayoutNode<T>;
    renderContent: ContentRenderer<T>;
    renderPreview?: PreviewRenderer<T>;
    onLeafClose: (node: LayoutNode<T>) => void;
    ready: boolean;
    transform: CSSProperties;
}

const dragItemType = "TILE_ITEM";

const TileNode = <T,>({
    layoutNode,
    renderContent,
    renderPreview,
    transform,
    onLeafClose,
    ready,
}: TileNodeProps<T>) => {
    const tileNodeRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);

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

    // Generate a preview div using the provided renderPreview function. This will be placed in the DOM so we can render an image from it, but it is pushed out of view so the user will not see it.
    // No-op if not provided, meaning React-DnD will attempt to generate a preview from the DOM, which is very slow.
    const preview = useMemo(() => {
        const previewElement = renderPreview?.(layoutNode.data);
        return (
            <div className="tile-preview-container">
                <div className="tile-preview" ref={previewRef}>
                    {previewElement}
                </div>
            </div>
        );
    }, []);

    // Cache the preview image after we generate it
    const [previewImage, setPreviewImage] = useState<HTMLImageElement>();

    // When a user first mouses over a node, generate a preview image and set it as the drag preview.
    const generatePreviewImage = useCallback(() => {
        if (previewImage) {
            dragPreview(previewImage);
        } else if (previewRef.current) {
            toPng(previewRef.current).then((url) => {
                const img = new Image();
                img.src = url;
                img.onload = () => dragPreview(img);
                setPreviewImage(img);
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
            {preview}
        </div>
    );
};

interface OverlayNodeProps<T> {
    layoutNode: LayoutNode<T>;
    layoutTreeState: LayoutTreeState<T>;
    dispatch: (action: LayoutTreeAction) => void;
    setRef: (id: string, ref: RefObject<HTMLDivElement>) => void;
    deleteRef: (id: string) => void;
}

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
                console.log("drop start", layoutNode.id, layoutTreeState.pendingAction);
                if (!monitor.didDrop() && layoutTreeState.pendingAction) {
                    dispatch({
                        type: LayoutTreeActionType.CommitPendingAction,
                    });
                }
            },
            hover: (_, monitor) => {
                if (monitor.isOver({ shallow: true }) && monitor.canDrop()) {
                    const dragItem = monitor.getItem<LayoutNode<T>>();
                    console.log("computing operation", layoutNode, dragItem, layoutTreeState.pendingAction);
                    dispatch({
                        type: LayoutTreeActionType.ComputeMove,
                        node: layoutNode,
                        nodeToMove: dragItem,
                        direction: determineDropDirection(
                            overlayRef.current?.getBoundingClientRect(),
                            monitor.getClientOffset()
                        ),
                    } as LayoutTreeComputeMoveNodeAction<T>);
                }
            },
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
    layoutTreeState: LayoutTreeState<T>;
    overlayContainerRef: React.RefObject<HTMLElement>;
    nodeRefs: Map<string, React.RefObject<HTMLElement>>;
    style: React.CSSProperties;
}

const Placeholder = <T,>({ layoutTreeState, overlayContainerRef, nodeRefs, style }: PlaceholderProps<T>) => {
    const [placeholderOverlay, setPlaceholderOverlay] = useState<ReactNode>(null);

    useEffect(() => {
        let newPlaceholderOverlay: ReactNode;
        if (layoutTreeState?.pendingAction?.type === LayoutTreeActionType.Move && overlayContainerRef?.current) {
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
                                parentNode.flexDirection === FlexDirection.Column && targetBoundingRect.height / 2;
                            placeholderDimensions.left +=
                                parentNode.flexDirection === FlexDirection.Row && targetBoundingRect.width / 2;
                        } else {
                            // Otherwise, place the placeholder between the target node (the one after which it will be inserted) and the next node
                            placeholderDimensions.top +=
                                parentNode.flexDirection === FlexDirection.Column &&
                                (3 * targetBoundingRect.height) / 4;
                            placeholderDimensions.left +=
                                parentNode.flexDirection === FlexDirection.Row && (3 * targetBoundingRect.width) / 4;
                        }
                    }
                    const placeholderTransform = createTransform(placeholderDimensions);

                    newPlaceholderOverlay = <div className="placeholder" style={{ ...placeholderTransform }} />;
                }
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
