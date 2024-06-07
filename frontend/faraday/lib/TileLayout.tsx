// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import {
    CSSProperties,
    ReactNode,
    RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useDrag, useDragLayer, useDrop } from "react-dnd";

import useResizeObserver from "@react-hook/resize-observer";
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
    WritableLayoutTreeStateAtom,
} from "./model.js";
import "./tilelayout.less";
import { FlexDirection, setTransform as createTransform, debounce, determineDropDirection } from "./utils.js";

export interface TileLayoutProps<T> {
    layoutTreeStateAtom: WritableLayoutTreeStateAtom<T>;
    renderContent: ContentRenderer<T>;
    onNodeDelete?: (data: T) => Promise<void>;
    className?: string;
}

export const TileLayout = <T,>({ layoutTreeStateAtom, className, renderContent, onNodeDelete }: TileLayoutProps<T>) => {
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const displayContainerRef = useRef<HTMLDivElement>(null);

    const [layoutTreeState, dispatch] = useLayoutTreeStateReducerAtom(layoutTreeStateAtom);
    const [nodeRefs, setNodeRefs] = useState<Map<string, RefObject<HTMLDivElement>>>(new Map());

    useEffect(() => {
        console.log("layoutTreeState changed", layoutTreeState);
    }, [layoutTreeState]);

    const setRef = useCallback(
        (id: string, ref: RefObject<HTMLDivElement>) => {
            setNodeRefs((prev) => {
                prev.set(id, ref);
                return prev;
            });
        },
        [setNodeRefs]
    );

    const deleteRef = useCallback(
        (id: string) => {
            if (nodeRefs.has(id)) {
                setNodeRefs((prev) => {
                    prev.delete(id);
                    return prev;
                });
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
        [activeDrag, overlayContainerRef, displayContainerRef, layoutTreeState.leafs, nodeRefs]
    );

    // Update the transforms whenever we drag something and whenever the layout updates.
    useLayoutEffect(() => {
        updateTransforms();
    }, [activeDrag, layoutTreeState, updateTransforms]);

    useResizeObserver(overlayContainerRef, () => updateTransforms());

    // Ensure that we don't see any jostling in the layout when we're rendering it the first time.
    // `animate` will be disabled until after the transforms have all applied the first time.
    // `overlayVisible` will be disabled until after the overlay has been pushed out of view.
    const [animate, setAnimate] = useState(false);
    const [overlayVisible, setOverlayVisible] = useState(false);
    useEffect(() => {
        setTimeout(() => {
            setAnimate(true);
        }, 50);
        setTimeout(() => {
            setOverlayVisible(true);
        }, 30);
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
        <div className={clsx("tile-layout", className, { animate, overlayVisible })}>
            <div key="display" ref={displayContainerRef} className="display-container">
                {layoutLeafTransforms &&
                    layoutTreeState.leafs.map((leaf) => {
                        return (
                            <TileNode
                                key={leaf.id}
                                layoutNode={leaf}
                                renderContent={renderContent}
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
    );
};

interface TileNodeProps<T> {
    layoutNode: LayoutNode<T>;
    renderContent: ContentRenderer<T>;
    onLeafClose: (node: LayoutNode<T>) => void;
    ready: boolean;
    transform: CSSProperties;
}

const dragItemType = "TILE_ITEM";

const TileNode = <T,>({ layoutNode, renderContent, transform, onLeafClose, ready }: TileNodeProps<T>) => {
    const tileNodeRef = useRef<HTMLDivElement>(null);

    const [{ isDragging, dragItem }, drag, dragPreview] = useDrag(
        () => ({
            type: dragItemType,
            item: () => layoutNode,
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
                dragItem: monitor.getItem<LayoutNode<T>>(),
            }),
        }),
        [layoutNode]
    );

    useEffect(() => {
        if (isDragging) {
            console.log("drag start", layoutNode.id, layoutNode, dragItem);
        }
    }, [isDragging]);

    // Register the tile item as a draggable component
    useEffect(() => {
        drag(tileNodeRef);
        dragPreview(tileNodeRef);
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
    }, [, layoutNode.data, ready, onClose]);

    return (
        <div
            className="tile-node"
            ref={tileNodeRef}
            id={layoutNode.id}
            style={{
                flexDirection: layoutNode.flexDirection,
                flexBasis: layoutNode.size,
                ...transform,
            }}
        >
            {leafContent}
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

                    let placeholderTransform: CSSProperties;
                    const placeholderHeight =
                        parentNode.flexDirection === FlexDirection.Column
                            ? targetBoundingRect.height / 2
                            : targetBoundingRect.height;
                    const placeholderWidth =
                        parentNode.flexDirection === FlexDirection.Row
                            ? targetBoundingRect.width / 2
                            : targetBoundingRect.width;
                    if (action.index > targetIndex) {
                        placeholderTransform = createTransform({
                            top:
                                targetBoundingRect.top +
                                (parentNode.flexDirection === FlexDirection.Column && targetBoundingRect.height / 2) -
                                overlayBoundingRect.top,
                            left:
                                targetBoundingRect.left +
                                (parentNode.flexDirection === FlexDirection.Row && targetBoundingRect.width / 2) -
                                overlayBoundingRect.left,
                            width: placeholderWidth,
                            height: placeholderHeight,
                        });
                    } else {
                        placeholderTransform = createTransform({
                            top: targetBoundingRect.top - overlayBoundingRect.top,
                            left: targetBoundingRect.left - overlayBoundingRect.left,
                            width: placeholderWidth,
                            height: placeholderHeight,
                        });
                    }

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
