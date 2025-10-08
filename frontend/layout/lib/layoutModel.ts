// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { focusManager } from "@/app/store/focusManager";
import { atomWithThrottle, boundNumber, fireAndForget } from "@/util/util";
import { Atom, atom, Getter, PrimitiveAtom, Setter } from "jotai";
import { splitAtom } from "jotai/utils";
import { createRef, CSSProperties } from "react";
import { debounce } from "throttle-debounce";
import { getLayoutStateAtomFromTab } from "./layoutAtom";
import { balanceNode, findNode, newLayoutNode, walkNodes } from "./layoutNode";
import {
    clearTree,
    computeMoveNode,
    deleteNode,
    focusNode,
    insertNode,
    insertNodeAtIndex,
    magnifyNodeToggle,
    moveNode,
    replaceNode,
    resizeNode,
    splitHorizontal,
    splitVertical,
    swapNode,
} from "./layoutTree";
import {
    ContentRenderer,
    FlexDirection,
    LayoutNode,
    LayoutNodeAdditionalProps,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeClearTreeAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeFocusNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeReplaceNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeSplitHorizontalAction,
    LayoutTreeSplitVerticalAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    NavigateDirection,
    NavigationResult,
    NodeModel,
    PreviewRenderer,
    ResizeHandleProps,
    TileLayoutContents,
} from "./types";
import { getCenter, navigateDirectionToOffset, setTransform } from "./utils";

interface ResizeContext {
    handleId: string;
    pixelToSizeRatio: number;
    displayContainerRect?: Dimensions;
    resizeHandleStartPx: number;
    beforeNodeId: string;
    beforeNodeStartSize: number;
    afterNodeId: string;
    afterNodeStartSize: number;
}

const DefaultGapSizePx = 3;
const MinNodeSizePx = 40;
const DefaultAnimationTimeS = 0.15;

export class LayoutModel {
    /**
     * Local atom holding the current tree state (source of truth during runtime)
     */
    private localTreeStateAtom: PrimitiveAtom<LayoutTreeState>;
    /**
     * The tree state (local cache)
     */
    treeState: LayoutTreeState;
    /**
     * Reference to the tab atom for accessing WaveObject
     */
    private tabAtom: Atom<Tab>;
    /**
     * WaveObject atom for persistence
     */
    private waveObjectAtom: WritableWaveObjectAtom<LayoutState>;
    /**
     * Debounce timer for persistence
     */
    private persistDebounceTimer: NodeJS.Timeout | null;
    /**
     * Set of action IDs that have been processed (prevents duplicate processing)
     */
    private processedActionIds: Set<string>;
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
    gapSizePx: PrimitiveAtom<number>;

    /**
     * The time a transition animation takes, in seconds.
     */
    animationTimeS: PrimitiveAtom<number>;

    /**
     * List of nodes that are leafs and should be rendered as a DisplayNode.
     */
    leafs: PrimitiveAtom<LayoutNode[]>;
    /**
     * An ordered list of node ids starting from the top left corner to the bottom right corner.
     */
    leafOrder: PrimitiveAtom<LeafOrderEntry[]>;
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

    // TODO: Nodes that need to be placed at higher z-indices should probably be handled by an ordered list, rather than individual properties.
    /**
     * The currently magnified node.
     */
    magnifiedNodeId: string;
    /**
     * Atom for the magnified node ID (derived from local tree state)
     */
    magnifiedNodeIdAtom: Atom<string>;
    /**
     * The last node to be magnified, other than the current magnified node, if set. This node should sit at a higher z-index than the others so that it floats above the other nodes as it returns to its original position.
     */
    lastMagnifiedNodeId: string;
    /**
     * Atom holding an ephemeral node that is not part of the layout tree. This node displays above all other nodes.
     */
    ephemeralNode: PrimitiveAtom<LayoutNode>;
    /**
     * The last node to be an ephemeral node. This node should sit at a higher z-index than the others so that it floats above the other nodes as it returns to its original position.
     */
    lastEphemeralNodeId: string;
    magnifiedNodeSizeAtom: Atom<number>;

    /**
     * The size of the resize handles, in CSS pixels.
     * The resize handle size is double the gap size, or double the default gap size, whichever is greater.
     * @see gapSizePx @see DefaultGapSizePx
     */
    private resizeHandleSizePx: Atom<number>;
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
        tabAtom: Atom<Tab>,
        getter: Getter,
        setter: Setter,
        renderContent?: ContentRenderer,
        renderPreview?: PreviewRenderer,
        onNodeDelete?: (data: TabLayoutData) => Promise<void>,
        gapSizePx?: number,
        animationTimeS?: number
    ) {
        this.tabAtom = tabAtom;
        this.getter = getter;
        this.setter = setter;
        this.renderContent = renderContent;
        this.renderPreview = renderPreview;
        this.onNodeDelete = onNodeDelete;
        this.gapSizePx = atom(gapSizePx ?? DefaultGapSizePx);
        this.resizeHandleSizePx = atom((get) => {
            const gapSizePx = get(this.gapSizePx);
            return 2 * (gapSizePx > 5 ? gapSizePx : DefaultGapSizePx);
        });
        this.animationTimeS = atom(animationTimeS ?? DefaultAnimationTimeS);
        this.persistDebounceTimer = null;
        this.processedActionIds = new Set();

        this.waveObjectAtom = getLayoutStateAtomFromTab(tabAtom, getter);

        this.localTreeStateAtom = atom<LayoutTreeState>({
            rootNode: undefined,
            focusedNodeId: undefined,
            magnifiedNodeId: undefined,
            leafOrder: undefined,
            pendingBackendActions: undefined,
        });

        this.treeState = {
            rootNode: undefined,
            focusedNodeId: undefined,
            magnifiedNodeId: undefined,
            leafOrder: undefined,
            pendingBackendActions: undefined,
        };

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

        this.ephemeralNode = atom();
        this.magnifiedNodeSizeAtom = getSettingsKeyAtom("window:magnifiedblocksize");

        this.magnifiedNodeIdAtom = atom((get) => {
            const treeState = get(this.localTreeStateAtom);
            return treeState.magnifiedNodeId;
        });

        this.focusedNode = atom((get) => {
            const ephemeralNode = get(this.ephemeralNode);
            const treeState = get(this.localTreeStateAtom);
            if (ephemeralNode) {
                return ephemeralNode;
            }
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

        this.initializeFromWaveObject();
    }

    private initializeFromWaveObject() {
        const waveObjState = this.getter(this.waveObjectAtom);

        const initialState: LayoutTreeState = {
            rootNode: waveObjState?.rootnode,
            focusedNodeId: waveObjState?.focusednodeid,
            magnifiedNodeId: waveObjState?.magnifiednodeid,
            leafOrder: undefined,
            pendingBackendActions: waveObjState?.pendingbackendactions,
        };

        this.treeState = initialState;
        this.magnifiedNodeId = initialState.magnifiedNodeId;
        this.setter(this.localTreeStateAtom, { ...initialState });

        if (initialState.pendingBackendActions?.length) {
            fireAndForget(() => this.processPendingBackendActions());
        } else {
            this.updateTree();
        }
    }

    onBackendUpdate() {
        const waveObj = this.getter(this.waveObjectAtom);
        const pendingActions = waveObj?.pendingbackendactions;
        if (pendingActions?.length) {
            fireAndForget(() => this.processPendingBackendActions());
        }
    }

    private async processPendingBackendActions() {
        const waveObj = this.getter(this.waveObjectAtom);
        const actions = waveObj?.pendingbackendactions;
        if (!actions?.length) return;

        this.treeState.pendingBackendActions = undefined;

        for (const action of actions) {
            if (!action.actionid) {
                console.warn("Dropping layout action without actionid:", action);
                continue;
            }
            if (this.processedActionIds.has(action.actionid)) {
                continue;
            }
            this.processedActionIds.add(action.actionid);
            await this.handleBackendAction(action);
        }

        this.updateTree();
        this.setter(this.localTreeStateAtom, { ...this.treeState });
        this.persistToBackend();
    }

    private async handleBackendAction(action: LayoutActionData) {
        switch (action.actiontype) {
            case LayoutTreeActionType.InsertNode: {
                if (action.ephemeral) {
                    this.newEphemeralNode(action.blockid);
                    break;
                }
                const insertNodeAction: LayoutTreeInsertNodeAction = {
                    type: LayoutTreeActionType.InsertNode,
                    node: newLayoutNode(undefined, undefined, undefined, {
                        blockId: action.blockid,
                    }),
                    magnified: action.magnified,
                    focused: action.focused,
                };
                this.treeReducer(insertNodeAction, false);
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
                    console.error("Cannot apply eventbus layout action InsertNodeAtIndex, indexarr field is missing.");
                    break;
                }
                const insertAction: LayoutTreeInsertNodeAtIndexAction = {
                    type: LayoutTreeActionType.InsertNodeAtIndex,
                    node: newLayoutNode(undefined, action.nodesize, undefined, {
                        blockId: action.blockid,
                    }),
                    indexArr: action.indexarr,
                    magnified: action.magnified,
                    focused: action.focused,
                };
                this.treeReducer(insertAction, false);
                break;
            }
            case LayoutTreeActionType.ClearTree: {
                this.treeReducer(
                    {
                        type: LayoutTreeActionType.ClearTree,
                    } as LayoutTreeClearTreeAction,
                    false
                );
                break;
            }
            case LayoutTreeActionType.ReplaceNode: {
                const targetNode = this?.getNodeByBlockId(action.targetblockid);
                if (!targetNode) {
                    console.error(
                        "Cannot apply eventbus layout action ReplaceNode, could not find target node with blockId",
                        action.targetblockid
                    );
                    break;
                }
                const replaceAction: LayoutTreeReplaceNodeAction = {
                    type: LayoutTreeActionType.ReplaceNode,
                    targetNodeId: targetNode.id,
                    newNode: newLayoutNode(undefined, action.nodesize, undefined, {
                        blockId: action.blockid,
                    }),
                };
                this.treeReducer(replaceAction, false);
                break;
            }
            case LayoutTreeActionType.SplitHorizontal: {
                const targetNode = this?.getNodeByBlockId(action.targetblockid);
                if (!targetNode) {
                    console.error(
                        "Cannot apply eventbus layout action SplitHorizontal, could not find target node with blockId",
                        action.targetblockid
                    );
                    break;
                }
                if (action.position != "before" && action.position != "after") {
                    console.error(
                        "Cannot apply eventbus layout action SplitHorizontal, invalid position",
                        action.position
                    );
                    break;
                }
                const newNode = newLayoutNode(undefined, action.nodesize, undefined, {
                    blockId: action.blockid,
                });
                const splitAction: LayoutTreeSplitHorizontalAction = {
                    type: LayoutTreeActionType.SplitHorizontal,
                    targetNodeId: targetNode.id,
                    newNode: newNode,
                    position: action.position,
                };
                this.treeReducer(splitAction, false);
                break;
            }
            case LayoutTreeActionType.SplitVertical: {
                const targetNode = this?.getNodeByBlockId(action.targetblockid);
                if (!targetNode) {
                    console.error(
                        "Cannot apply eventbus layout action SplitVertical, could not find target node with blockId",
                        action.targetblockid
                    );
                    break;
                }
                if (action.position != "before" && action.position != "after") {
                    console.error(
                        "Cannot apply eventbus layout action SplitVertical, invalid position",
                        action.position
                    );
                    break;
                }
                const newNode = newLayoutNode(undefined, action.nodesize, undefined, {
                    blockId: action.blockid,
                });
                const splitAction: LayoutTreeSplitVerticalAction = {
                    type: LayoutTreeActionType.SplitVertical,
                    targetNodeId: targetNode.id,
                    newNode: newNode,
                    position: action.position,
                };
                this.treeReducer(splitAction, false);
                break;
            }
            default:
                console.warn("unsupported layout action", action);
                break;
        }
    }

    private persistToBackend() {
        if (this.persistDebounceTimer) {
            clearTimeout(this.persistDebounceTimer);
        }

        this.persistDebounceTimer = setTimeout(() => {
            const waveObj = this.getter(this.waveObjectAtom);
            if (!waveObj) return;

            waveObj.rootnode = this.treeState.rootNode;
            waveObj.focusednodeid = this.treeState.focusedNodeId;
            waveObj.magnifiednodeid = this.treeState.magnifiedNodeId;
            waveObj.leaforder = this.treeState.leafOrder;
            waveObj.pendingbackendactions = this.treeState.pendingBackendActions;

            this.setter(this.waveObjectAtom, waveObj);
            this.persistDebounceTimer = null;
        }, 100);
    }

    /**
     * Register TileLayout callbacks that should be called on various state changes.
     * @param contents Contains callbacks provided by the TileLayout component.
     */
    registerTileLayout(contents: TileLayoutContents) {
        this.renderContent = contents.renderContent;
        this.renderPreview = contents.renderPreview;
        this.onNodeDelete = contents.onNodeDelete;
        if (contents.gapSizePx !== undefined) {
            this.setter(this.gapSizePx, contents.gapSizePx);
        }
    }

    /**
     * Perform an action against the layout tree state.
     * @param action The action to perform.
     */
    treeReducer(action: LayoutTreeAction, setState = true) {
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
                if ((action as LayoutTreeInsertNodeAction).focused) {
                    focusManager.requestNodeFocus();
                }
                break;
            case LayoutTreeActionType.InsertNodeAtIndex:
                insertNodeAtIndex(this.treeState, action as LayoutTreeInsertNodeAtIndexAction);
                if ((action as LayoutTreeInsertNodeAtIndexAction).focused) {
                    focusManager.requestNodeFocus();
                }
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
                focusManager.requestNodeFocus();
                break;
            case LayoutTreeActionType.MagnifyNodeToggle:
                magnifyNodeToggle(this.treeState, action as LayoutTreeMagnifyNodeToggleAction);
                focusManager.requestNodeFocus();
                break;
            case LayoutTreeActionType.ClearTree:
                clearTree(this.treeState);
                break;
            case LayoutTreeActionType.ReplaceNode:
                replaceNode(this.treeState, action as LayoutTreeReplaceNodeAction);
                break;
            case LayoutTreeActionType.SplitHorizontal:
                splitHorizontal(this.treeState, action as LayoutTreeSplitHorizontalAction);
                break;
            case LayoutTreeActionType.SplitVertical:
                splitVertical(this.treeState, action as LayoutTreeSplitVerticalAction);
                break;
            default:
                console.error("Invalid reducer action", this.treeState, action);
        }
        if (this.magnifiedNodeId !== this.treeState.magnifiedNodeId) {
            this.lastMagnifiedNodeId = this.magnifiedNodeId;
            this.lastEphemeralNodeId = undefined;
            this.magnifiedNodeId = this.treeState.magnifiedNodeId;
        }
        if (setState) {
            this.updateTree();
            this.setter(this.localTreeStateAtom, { ...this.treeState });
            this.persistToBackend();
        }
    }

    /**
     * Callback that is invoked when the upstream tree state has been updated. This ensures the model is updated if the atom is not fully loaded when the model is first instantiated.
     * @param force Whether to force the local tree state to update, regardless of whether the state is already up to date.
     */
    async onTreeStateAtomUpdated(force = false) {
        if (force) {
            this.updateTree();
            this.setter(this.localTreeStateAtom, { ...this.treeState });
        }
    }

    /**
     * Set the upstream tree state atom to the value of the local tree state.
     * @param bumpGeneration Whether to bump the generation of the tree state before setting the atom.
     */

    /**
     * Recursively walks the tree to find leaf nodes, update the resize handles, and compute additional properties for each node.
     * @param balanceTree Whether the tree should also be balanced as it is walked. This should be done if the tree state has just been updated. Defaults to true.
     */
    updateTree(balanceTree = true) {
        if (this.displayContainerRef.current) {
            const newLeafs: LayoutNode[] = [];
            const newAdditionalProps = {};

            const pendingAction = this.getter(this.pendingTreeAction.currentValueAtom);
            const resizeAction =
                pendingAction?.type === LayoutTreeActionType.ResizeNode
                    ? (pendingAction as LayoutTreeResizeNodeAction)
                    : null;
            const resizeHandleSizePx = this.getter(this.resizeHandleSizePx);

            const boundingRect = this.getBoundingRect();

            const magnifiedNodeSize = this.getter(this.magnifiedNodeSizeAtom);

            const callback = (node: LayoutNode) =>
                this.updateTreeHelper(
                    node,
                    newAdditionalProps,
                    newLeafs,
                    resizeHandleSizePx,
                    magnifiedNodeSize,
                    boundingRect,
                    resizeAction
                );
            if (balanceTree) this.treeState.rootNode = balanceNode(this.treeState.rootNode, callback);
            else walkNodes(this.treeState.rootNode, callback);

            // Process ephemeral node, if present.
            const ephemeralNode = this.getter(this.ephemeralNode);
            if (ephemeralNode) {
                console.log("updateTree ephemeralNode", ephemeralNode);
                this.updateEphemeralNodeProps(
                    ephemeralNode,
                    newAdditionalProps,
                    newLeafs,
                    magnifiedNodeSize,
                    boundingRect
                );
            }

            this.treeState.leafOrder = getLeafOrder(newLeafs, newAdditionalProps);
            this.validateFocusedNode(this.treeState.leafOrder);
            this.validateMagnifiedNode(this.treeState.leafOrder, newAdditionalProps);
            this.cleanupNodeModels(this.treeState.leafOrder);
            this.setter(
                this.leafs,
                newLeafs.sort((a, b) => a.id.localeCompare(b.id))
            );
            this.setter(this.leafOrder, this.treeState.leafOrder);
            this.setter(this.additionalProps, newAdditionalProps);
        }
    }

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
        resizeHandleSizePx: number,
        magnifiedNodeSizePct: number,
        boundingRect: Dimensions,
        resizeAction?: LayoutTreeResizeNodeAction
    ) {
        if (!node.children?.length) {
            leafs.push(node);
            const addlProps = additionalPropsMap[node.id];
            if (addlProps) {
                if (this.magnifiedNodeId === node.id) {
                    const magnifiedNodeMarginPct = (1 - magnifiedNodeSizePct) / 2;
                    const transform = setTransform(
                        {
                            top: boundingRect.height * magnifiedNodeMarginPct,
                            left: boundingRect.width * magnifiedNodeMarginPct,
                            width: boundingRect.width * magnifiedNodeSizePct,
                            height: boundingRect.height * magnifiedNodeSizePct,
                        },
                        true,
                        true,
                        "var(--zindex-layout-magnified-node)"
                    );
                    addlProps.transform = transform;
                }
                if (this.lastMagnifiedNodeId === node.id) {
                    addlProps.transform.zIndex = "var(--zindex-layout-last-magnified-node)";
                } else if (this.lastEphemeralNodeId === node.id) {
                    addlProps.transform.zIndex = "var(--zindex-layout-last-ephemeral-node)";
                }
            }
            return;
        }

        function getNodeSize(node: LayoutNode) {
            return resizeAction?.resizeOperations.find((op) => op.nodeId === node.id)?.size ?? node.size;
        }

        const additionalProps: LayoutNodeAdditionalProps = additionalPropsMap.hasOwnProperty(node.id)
            ? additionalPropsMap[node.id]
            : { treeKey: "0" };

        const nodeRect: Dimensions = node.id === this.treeState.rootNode.id ? boundingRect : additionalProps.rect;
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
                const halfResizeHandleSizePx = resizeHandleSizePx / 2;
                const resizeHandleDimensions: Dimensions = {
                    top: nodeIsRow
                        ? lastChildRect.top
                        : lastChildRect.top + lastChildRect.height - halfResizeHandleSizePx,
                    left: nodeIsRow
                        ? lastChildRect.left + lastChildRect.width - halfResizeHandleSizePx
                        : lastChildRect.left,
                    width: nodeIsRow ? resizeHandleSizePx : lastChildRect.width,
                    height: nodeIsRow ? lastChildRect.height : resizeHandleSizePx,
                };
                resizeHandles.push({
                    id: `${node.id}-${resizeHandleIndex}`,
                    parentNodeId: node.id,
                    parentIndex: resizeHandleIndex,
                    transform: setTransform(resizeHandleDimensions, true, false),
                    flexDirection: node.flexDirection,
                    centerPx:
                        (nodeIsRow ? resizeHandleDimensions.left : resizeHandleDimensions.top) + halfResizeHandleSizePx,
                });
            }
            lastChildRect = rect;
        });

        additionalPropsMap[node.id] = {
            ...additionalProps,
            ...(node.data?.blockId ? { rect: nodeRect } : {}),
            pixelToSizeRatio,
            resizeHandles,
        };
    }

    /**
     * Gets normalized dimensions for the TileLayout container.
     * @returns The normalized dimensions for the TileLayout container.
     */
    getBoundingRect: () => Dimensions = () => {
        const boundingRect = this.displayContainerRef.current.getBoundingClientRect();
        return { top: 0, left: 0, width: boundingRect.width, height: boundingRect.height };
    };

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
    private validateFocusedNode(leafOrder: LeafOrderEntry[]) {
        if (this.treeState.focusedNodeId !== this.focusedNodeId) {
            // Remove duplicates and stale entries from focus stack.
            const newFocusedNodeIdStack: string[] = [];
            for (const id of this.focusedNodeIdStack) {
                if (leafOrder.find((leafEntry) => leafEntry?.nodeid === id) && !newFocusedNodeIdStack.includes(id))
                    newFocusedNodeIdStack.push(id);
            }
            this.focusedNodeIdStack = newFocusedNodeIdStack;

            // Update the focused node and stack based on the changes in the tree state.
            if (!this.treeState.focusedNodeId) {
                if (this.focusedNodeIdStack.length > 0) {
                    this.treeState.focusedNodeId = this.focusedNodeIdStack.shift();
                } else if (leafOrder.length > 0) {
                    // If no nodes are in the stack, use the top left node in the layout.
                    this.treeState.focusedNodeId = leafOrder[0].nodeid;
                }
            }
            this.focusedNodeIdStack.unshift(this.treeState.focusedNodeId);
        }
    }

    /**
     * When a layout is modified and only one leaf is remaining, we need to make sure it is no longer magnified.
     * @param leafOrder The new leaf order array to use when validating the number of leafs remaining.
     * @param addlProps The new additional properties object for all leafs in the layout.
     */
    private validateMagnifiedNode(leafOrder: LeafOrderEntry[], addlProps: Record<string, LayoutNodeAdditionalProps>) {
        if (leafOrder.length == 1) {
            const lastLeafId = leafOrder[0].nodeid;
            this.treeState.magnifiedNodeId = undefined;
            this.magnifiedNodeId = undefined;

            // Unset the transform for the sole leaf.
            if (addlProps.hasOwnProperty(lastLeafId)) addlProps[lastLeafId].transform = undefined;
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
                innerRect: atom((get) => {
                    const addlProps = get(addlPropsAtom);
                    const numLeafs = get(this.numLeafs);
                    const gapSizePx = get(this.gapSizePx);
                    if (numLeafs > 1 && addlProps?.rect) {
                        return {
                            width: `${addlProps.transform.width} - ${gapSizePx}px`,
                            height: `${addlProps.transform.height} - ${gapSizePx}px`,
                        } as CSSProperties;
                    } else {
                        return null;
                    }
                }),
                nodeId: nodeid,
                blockId,
                blockNum: atom((get) => get(this.leafOrder).findIndex((leafEntry) => leafEntry.nodeid === nodeid) + 1),
                isFocused: atom((get) => {
                    const treeState = get(this.localTreeStateAtom);
                    const isFocused = treeState.focusedNodeId === nodeid;
                    const focusType = get(focusManager.focusType);
                    return isFocused && focusType === "node";
                }),
                numLeafs: this.numLeafs,
                isResizing: this.isResizing,
                isMagnified: atom((get) => {
                    const treeState = get(this.localTreeStateAtom);
                    return treeState.magnifiedNodeId === nodeid;
                }),
                isEphemeral: atom((get) => {
                    const ephemeralNode = get(this.ephemeralNode);
                    return ephemeralNode?.id === nodeid;
                }),
                addEphemeralNodeToLayout: () => this.addEphemeralNodeToLayout(),
                animationTimeS: this.animationTimeS,
                ready: this.ready,
                disablePointerEvents: this.activeDrag,
                onClose: () => fireAndForget(() => this.closeNode(nodeid)),
                toggleMagnify: () => this.magnifyNodeToggle(nodeid),
                focusNode: () => this.focusNode(nodeid),
                dragHandleRef: createRef(),
                displayContainerRef: this.displayContainerRef,
            });
        }
        const nodeModel = this.nodeModels.get(nodeid);
        return nodeModel;
    }

    /**
     * Remove orphaned node models when their corresponding leaf is deleted.
     * @param leafOrder The new leaf order array to use when locating orphaned nodes.
     */
    private cleanupNodeModels(leafOrder: LeafOrderEntry[]) {
        const orphanedNodeModels = [...this.nodeModels.keys()].filter(
            (id) => !leafOrder.find((leafEntry) => leafEntry.nodeid == id)
        );
        for (const id of orphanedNodeModels) {
            this.nodeModels.delete(id);
        }
    }

    /**
     * Switch focus to the next node in the given direction in the layout.
     * @param direction The direction in which to switch focus.
     */
    switchNodeFocusInDirection(direction: NavigateDirection, inWaveAI: boolean): NavigationResult {
        const curNodeId = this.focusedNodeId;

        // If no node is focused, set focus to the first leaf.
        if (!curNodeId) {
            this.focusNode(this.getter(this.leafOrder)[0].nodeid);
            return { success: true };
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
        let curNodePos: Dimensions;
        if (inWaveAI) {
            // For WaveAI, use a fake position to the left of all nodes
            curNodePos = { left: -10, top: 10, width: 0, height: 0 };

            // Only allow "right" navigation from WaveAI
            if (direction !== NavigateDirection.Right) {
                const result: NavigationResult = { success: false };
                if (direction === NavigateDirection.Up) {
                    result.atTop = true;
                } else if (direction === NavigateDirection.Down) {
                    result.atBottom = true;
                } else if (direction === NavigateDirection.Left) {
                    result.atLeft = true;
                }
                return result;
            }
        } else {
            curNodePos = nodePositions.get(curNodeId);
            if (!curNodePos) {
                return { success: false };
            }
            nodePositions.delete(curNodeId);
        }
        const boundingRect = this.displayContainerRef?.current.getBoundingClientRect();
        if (!boundingRect) {
            return { success: false };
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
                // Determine which boundary was hit
                const result: NavigationResult = { success: false };
                if (curPoint.x < 0) {
                    result.atLeft = true;
                }
                if (curPoint.x > maxX) {
                    result.atRight = true;
                }
                if (curPoint.y < 0) {
                    result.atTop = true;
                }
                if (curPoint.y > maxY) {
                    result.atBottom = true;
                }
                return result;
            }
            const nodeId = findNodeAtPoint(nodePositions, curPoint);
            if (nodeId != null) {
                this.focusNode(nodeId);
                return { success: true };
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
        const leaf = leafOrder[newLeafIdx];
        this.focusNode(leaf.nodeid);
    }

    /**
     * Set the layout to focus on the given node.
     * @param nodeId The id of the node that is being focused.
     */
    focusNode(nodeId: string) {
        if (this.focusedNodeId === nodeId) return;
        let layoutNode = findNode(this.treeState?.rootNode, nodeId);
        if (!layoutNode) {
            const ephemeralNode = this.getter(this.ephemeralNode);
            if (ephemeralNode?.id === nodeId) {
                layoutNode = ephemeralNode;
            } else {
                console.error("unable to focus node, cannot find it in tree", nodeId);
                return;
            }
        }
        const action: LayoutTreeFocusNodeAction = {
            type: LayoutTreeActionType.FocusNode,
            nodeId: nodeId,
        };

        this.treeReducer(action);
    }

    focusFirstNode() {
        const leafOrder = this.getter(this.leafOrder);
        if (leafOrder.length > 0) {
            this.focusNode(leafOrder[0].nodeid);
        }
    }

    getFirstBlockId(): string | undefined {
        const leafOrder = this.getter(this.leafOrder);
        if (leafOrder.length > 0) {
            return leafOrder[0].blockid;
        }
        return undefined;
    }

    /**
     * Toggle magnification of a given node.
     * @param nodeId The id of the node that is being magnified.
     */
    magnifyNodeToggle(nodeId: string, setState = true) {
        const action: LayoutTreeMagnifyNodeToggleAction = {
            type: LayoutTreeActionType.MagnifyNodeToggle,
            nodeId: nodeId,
        };

        // Unset the last ephemeral node id to ensure the magnify animation sits on top of the layout.
        this.lastEphemeralNodeId = undefined;

        this.treeReducer(action, setState);
    }

    /**
     * Close a given node and update the tree state.
     * @param nodeId The id of the node that is being closed.
     */
    async closeNode(nodeId: string) {
        const nodeToDelete = findNode(this.treeState.rootNode, nodeId);
        if (!nodeToDelete) {
            // TODO: clean up the ephemeral node handling
            // The ephemeral node is not in the tree, so we need to handle it separately.
            const ephemeralNode = this.getter(this.ephemeralNode);
            if (ephemeralNode?.id === nodeId) {
                this.setter(this.ephemeralNode, undefined);
                this.treeState.focusedNodeId = undefined;
                this.updateTree(false);
                this.setter(this.localTreeStateAtom, { ...this.treeState });
                this.persistToBackend();
                await this.onNodeDelete?.(ephemeralNode.data);
                return;
            }
            console.error("unable to close node, cannot find it in tree", nodeId);
            return;
        }
        if (nodeId === this.magnifiedNodeId) {
            this.magnifyNodeToggle(nodeId);
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

    newEphemeralNode(blockId: string) {
        if (this.getter(this.ephemeralNode)) {
            this.closeNode(this.getter(this.ephemeralNode).id);
        }

        const ephemeralNode = newLayoutNode(undefined, undefined, undefined, { blockId });
        this.setter(this.ephemeralNode, ephemeralNode);

        const addlProps = this.getter(this.additionalProps);
        const leafs = this.getter(this.leafs);
        const boundingRect = this.getBoundingRect();
        const magnifiedNodeSizePct = this.getter(this.magnifiedNodeSizeAtom);
        this.updateEphemeralNodeProps(ephemeralNode, addlProps, leafs, magnifiedNodeSizePct, boundingRect);
        this.setter(this.additionalProps, addlProps);
        this.focusNode(ephemeralNode.id);
    }

    addEphemeralNodeToLayout() {
        const ephemeralNode = this.getter(this.ephemeralNode);
        this.setter(this.ephemeralNode, undefined);
        if (this.magnifiedNodeId) {
            this.magnifyNodeToggle(this.magnifiedNodeId, false);
        }
        this.lastEphemeralNodeId = ephemeralNode.id;
        if (ephemeralNode) {
            const action: LayoutTreeInsertNodeAction = {
                type: LayoutTreeActionType.InsertNode,
                node: ephemeralNode,
                magnified: false,
                focused: false,
            };
            this.treeReducer(action);
        }
    }

    updateEphemeralNodeProps(
        node: LayoutNode,
        addlPropsMap: Record<string, LayoutNodeAdditionalProps>,
        leafs: LayoutNode[],
        magnifiedNodeSizePct: number,
        boundingRect: Dimensions
    ) {
        const ephemeralNodeSizePct = this.magnifiedNodeId
            ? magnifiedNodeSizePct * magnifiedNodeSizePct
            : magnifiedNodeSizePct;
        const ephemeralNodeMarginPct = (1 - ephemeralNodeSizePct) / 2;
        const transform = setTransform(
            {
                top: boundingRect.height * ephemeralNodeMarginPct,
                left: boundingRect.width * ephemeralNodeMarginPct,
                width: boundingRect.width * ephemeralNodeSizePct,
                height: boundingRect.height * ephemeralNodeSizePct,
            },
            true,
            true,
            "var(--zindex-layout-ephemeral-node)"
        );
        addlPropsMap[node.id] = { treeKey: "-1", transform };
        leafs.push(node);
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

        // If the resize context is out of date, update it and save it for future events.
        if (this.resizeContext?.handleId !== resizeHandle.id) {
            const parentNode = findNode(this.treeState.rootNode, resizeHandle.parentNodeId);
            const beforeNode = parentNode.children![resizeHandle.parentIndex];
            const afterNode = parentNode.children![resizeHandle.parentIndex + 1];

            const addlProps = this.getter(this.additionalProps);
            const pixelToSizeRatio = addlProps[resizeHandle.parentNodeId]?.pixelToSizeRatio;
            if (beforeNode && afterNode && pixelToSizeRatio) {
                this.resizeContext = {
                    handleId: resizeHandle.id,
                    displayContainerRect: this.displayContainerRef.current?.getBoundingClientRect(),
                    resizeHandleStartPx: resizeHandle.centerPx,
                    beforeNodeId: beforeNode.id,
                    afterNodeId: afterNode.id,
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

        const clientPoint = parentIsRow
            ? x - this.resizeContext.displayContainerRect?.left
            : y - this.resizeContext.displayContainerRect?.top;
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
                    nodeId: this.resizeContext.beforeNodeId,
                    size: beforeNodeSize,
                },
                {
                    nodeId: this.resizeContext.afterNodeId,
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

function getLeafOrder(
    leafs: LayoutNode[],
    additionalProps: Record<string, LayoutNodeAdditionalProps>
): LeafOrderEntry[] {
    return leafs
        .map((node) => ({ nodeid: node.id, blockid: node.data.blockId }) as LeafOrderEntry)
        .sort((a, b) => {
            const treeKeyA = additionalProps[a.nodeid]?.treeKey;
            const treeKeyB = additionalProps[b.nodeid]?.treeKey;
            if (!treeKeyA || !treeKeyB) return;
            return treeKeyA.localeCompare(treeKeyB);
        });
}
