// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    BlockComponentModel2,
    BlockNodeModel,
    BlockProps,
    FullBlockProps,
    FullSubBlockProps,
    SubBlockProps,
} from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { useTabModel } from "@/app/store/tab-model";
import { AiFileDiffViewModel } from "@/app/view/aifilediff/aifilediff";
import { LauncherViewModel } from "@/app/view/launcher/launcher";
import { PreviewModel } from "@/app/view/preview/preview-model";
import { SysinfoViewModel } from "@/app/view/sysinfo/sysinfo";
import { TsunamiViewModel } from "@/app/view/tsunami/tsunami";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { useWaveEnv, WaveEnv } from "@/app/waveenv/waveenv";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { useDebouncedNodeInnerRect } from "@/layout/index";
import { counterInc } from "@/store/counters";
import { getBlockComponentModel, registerBlockComponentModel, unregisterBlockComponentModel } from "@/store/global";
import { makeORef } from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import { isBlank, useAtomValueSafe } from "@/util/util";
import { HelpViewModel } from "@/view/helpview/helpview";
import { TermViewModel } from "@/view/term/term-model";
import { WaveAiModel } from "@/view/waveai/waveai";
import { WebViewModel } from "@/view/webview/webview";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { QuickTipsViewModel } from "../view/quicktipsview/quicktipsview";
import { WaveConfigViewModel } from "../view/waveconfig/waveconfig-model";
import { WIDGET_REGISTRY_ENTRIES } from "@/widgets/index";
import "./block.scss";
import { BlockEnv } from "./blockenv";
import { BlockFrame } from "./blockframe";
import { blockViewToIcon, blockViewToName } from "./blockutil";

const BlockRegistry: Map<string, ViewModelClass> = new Map();
BlockRegistry.set("term", TermViewModel);
BlockRegistry.set("preview", PreviewModel);
BlockRegistry.set("web", WebViewModel);
BlockRegistry.set("waveai", WaveAiModel);
BlockRegistry.set("cpuplot", SysinfoViewModel);
BlockRegistry.set("sysinfo", SysinfoViewModel);
BlockRegistry.set("vdom", VDomModel);
BlockRegistry.set("tips", QuickTipsViewModel);
BlockRegistry.set("help", HelpViewModel);
BlockRegistry.set("launcher", LauncherViewModel);
BlockRegistry.set("tsunami", TsunamiViewModel);
BlockRegistry.set("aifilediff", AiFileDiffViewModel);
BlockRegistry.set("waveconfig", WaveConfigViewModel);
// Register financial/DeFi widgets (defined in frontend/widgets/)
for (const [viewType, cls] of WIDGET_REGISTRY_ENTRIES) {
    BlockRegistry.set(viewType, cls);
}

function makeViewModel(
    blockId: string,
    blockView: string,
    nodeModel: BlockNodeModel,
    tabModel: TabModel,
    waveEnv: WaveEnv
): ViewModel {
    const ctor = BlockRegistry.get(blockView);
    if (ctor != null) {
        return new ctor({ blockId, nodeModel, tabModel, waveEnv });
    }
    return makeDefaultViewModel(blockView);
}

function getViewElem(
    blockId: string,
    blockRef: React.RefObject<HTMLDivElement>,
    contentRef: React.RefObject<HTMLDivElement>,
    blockView: string,
    viewModel: ViewModel
): React.ReactElement {
    if (isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (viewModel.viewComponent == null) {
        return <CenteredDiv>No View Component</CenteredDiv>;
    }
    const VC = viewModel.viewComponent;
    return <VC key={blockId} blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={viewModel} />;
}

function makeDefaultViewModel(viewType: string): ViewModel {
    const viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: atom(blockViewToIcon(viewType)),
        viewName: atom(blockViewToName(viewType)),
        preIconButton: atom(null),
        endIconButtons: atom(null),
        viewComponent: null,
    };
    return viewModel;
}

const BlockPreview = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", nodeModel.blockId)));
    if (blockIsNull) {
        return null;
    }
    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockSubBlock = memo(({ nodeModel, viewModel }: FullSubBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", nodeModel.blockId)));
    const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view")) ?? "";
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockView, viewModel),
        [nodeModel.blockId, blockView, viewModel]
    );
    const noPadding = useAtomValueSafe(viewModel.noPadding);
    if (blockIsNull) {
        return null;
    }
    return (
        <div key="content" className={clsx("block-content", { "block-no-padding": noPadding })} ref={contentRef}>
            <ErrorBoundary>
                <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
            </ErrorBoundary>
        </div>
    );
});

const BlockFull = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const waveEnv = useWaveEnv<BlockEnv>();
    const focusElemRef = useRef<HTMLInputElement>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = useState(false);
    const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view")) ?? "";
    const isFocused = useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = useAtomValue(nodeModel.disablePointerEvents);
    const isResizing = useAtomValue(nodeModel.isResizing);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const anyMagnified = useAtomValue(nodeModel.anyMagnified);
    const modalOpen = useAtomValue(waveEnv.atoms.modalOpen);
    const focusFollowsCursorMode = useAtomValue(waveEnv.getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const innerRect = useDebouncedNodeInnerRect(nodeModel);
    const noPadding = useAtomValueSafe(viewModel.noPadding);

    useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = focusedBlockId() == nodeModel.blockId;
        if (!focusWithin) {
            setFocusTarget();
        }
        if (!isFocused) {
            nodeModel.focusNode();
        }
    }, [blockClicked, isFocused]);

    const setBlockClickedTrue = useCallback(() => {
        setBlockClicked(true);
    }, []);

    const [blockContentOffset, setBlockContentOffset] = useState<Dimensions>();

    useEffect(() => {
        if (blockRef.current && contentRef.current) {
            const blockRect = blockRef.current.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();
            setBlockContentOffset({
                top: 0,
                left: 0,
                width: blockRect.width - contentRect.width,
                height: blockRect.height - contentRect.height,
            });
        }
    }, [blockRef, contentRef]);

    const blockContentStyle = useMemo<React.CSSProperties>(() => {
        const retVal: React.CSSProperties = {
            pointerEvents: disablePointerEvents ? "none" : undefined,
        };
        if (innerRect?.width && innerRect.height && blockContentOffset) {
            retVal.width = `calc(${innerRect?.width} - ${blockContentOffset.width}px)`;
            retVal.height = `calc(${innerRect?.height} - ${blockContentOffset.height}px)`;
        }
        return retVal;
    }, [innerRect, disablePointerEvents, blockContentOffset]);

    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockView, viewModel),
        [nodeModel.blockId, blockView, viewModel]
    );

    const handleChildFocus = useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            console.log("setFocusedChild", nodeModel.blockId, getElemAsStr(event.target));
            if (!isFocused) {
                console.log("focusedChild focus", nodeModel.blockId);
                nodeModel.focusNode();
            }
        },
        [isFocused]
    );

    const setFocusTarget = useCallback(() => {
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
    }, [viewModel]);

    const focusFromPointerEnter = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            const focusFollowsCursorEnabled =
                focusFollowsCursorMode === "on" ||
                (focusFollowsCursorMode === "term" && blockView === "term");
            if (!focusFollowsCursorEnabled || event.pointerType === "touch" || event.buttons > 0) {
                return;
            }
            if (modalOpen || disablePointerEvents || isResizing || (anyMagnified && !isMagnified)) {
                return;
            }
            if (isFocused && focusedBlockId() === nodeModel.blockId) {
                return;
            }
            setFocusTarget();
            if (!isFocused) {
                nodeModel.focusNode();
            }
        },
        [
            focusFollowsCursorMode,
            blockView,
            modalOpen,
            disablePointerEvents,
            isResizing,
            isMagnified,
            anyMagnified,
            isFocused,
            nodeModel,
            setFocusTarget,
        ]
    );

    const blockModel = useMemo<BlockComponentModel2>(
        () => ({
            onClick: setBlockClickedTrue,
            onPointerEnter: focusFromPointerEnter,
            onFocusCapture: handleChildFocus,
            blockRef: blockRef,
        }),
        [setBlockClickedTrue, focusFromPointerEnter, handleChildFocus, blockRef]
    );

    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    id={`${nodeModel.blockId}-dummy-focus`} // don't change this name (used in refocusNode)
                    className="dummy-focus"
                    onChange={() => {}}
                />
            </div>
            <div
                key="content"
                className={clsx("block-content", { "block-no-padding": noPadding })}
                ref={contentRef}
                style={blockContentStyle}
            >
                <ErrorBoundary>
                    <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const BlockInner = memo((props: BlockProps & { viewType: string }) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const waveEnv = useWaveEnv();
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null) {
        // viewModel gets the full waveEnv
        viewModel = makeViewModel(props.nodeModel.blockId, props.viewType, props.nodeModel, tabModel, waveEnv);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});
BlockInner.displayName = "BlockInner";

const Block = memo((props: BlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const isNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", props.nodeModel.blockId)));
    const viewType = useAtomValue(waveEnv.getBlockMetaKeyAtom(props.nodeModel.blockId, "view")) ?? "";
    if (isNull || isBlank(props.nodeModel.blockId)) {
        return null;
    }
    return <BlockInner key={props.nodeModel.blockId + ":" + viewType} {...props} viewType={viewType} />;
});

const SubBlockInner = memo((props: SubBlockProps & { viewType: string }) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const waveEnv = useWaveEnv();
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null) {
        // viewModel gets the full waveEnv
        viewModel = makeViewModel(props.nodeModel.blockId, props.viewType, props.nodeModel, tabModel, waveEnv);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    return <BlockSubBlock {...props} viewModel={viewModel} />;
});
SubBlockInner.displayName = "SubBlockInner";

const SubBlock = memo((props: SubBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const isNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", props.nodeModel.blockId)));
    const viewType = useAtomValue(waveEnv.getBlockMetaKeyAtom(props.nodeModel.blockId, "view")) ?? "";
    if (isNull || isBlank(props.nodeModel.blockId)) {
        return null;
    }
    return <SubBlockInner key={props.nodeModel.blockId + ":" + viewType} {...props} viewType={viewType} />;
});

export { Block, SubBlock };
