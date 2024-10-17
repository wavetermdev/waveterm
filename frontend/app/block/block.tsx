// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockComponentModel2, BlockProps } from "@/app/block/blocktypes";
import { PlotView } from "@/app/view/plotview/plotview";
import { PreviewModel, PreviewView, makePreviewModel } from "@/app/view/preview/preview";
import { SysinfoView, SysinfoViewModel, makeSysinfoViewModel } from "@/app/view/sysinfo/sysinfo";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { NodeModel, useDebouncedNodeInnerRect } from "@/layout/index";
import {
    counterInc,
    getBlockComponentModel,
    registerBlockComponentModel,
    unregisterBlockComponentModel,
} from "@/store/global";
import { getWaveObjectAtom, makeORef, useWaveObjectValue } from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import { isBlank } from "@/util/util";
import { HelpView, HelpViewModel, makeHelpViewModel } from "@/view/helpview/helpview";
import { QuickTipsView, QuickTipsViewModel } from "@/view/quicktipsview/quicktipsview";
import { TermViewModel, TerminalView, makeTerminalModel } from "@/view/term/term";
import { WaveAi, WaveAiModel, makeWaveAiViewModel } from "@/view/waveai/waveai";
import { WebView, WebViewModel, makeWebViewModel } from "@/view/webview/webview";
import { atom, useAtomValue } from "jotai";
import { Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./block.less";
import { BlockFrame } from "./blockframe";
import { blockViewToIcon, blockViewToName } from "./blockutil";

type FullBlockProps = {
    preview: boolean;
    nodeModel: NodeModel;
    viewModel: ViewModel;
};

function makeViewModel(blockId: string, blockView: string, nodeModel: NodeModel): ViewModel {
    if (blockView === "term") {
        return makeTerminalModel(blockId);
    }
    if (blockView === "preview") {
        return makePreviewModel(blockId, nodeModel);
    }
    if (blockView === "web") {
        return makeWebViewModel(blockId, nodeModel);
    }
    if (blockView === "waveai") {
        return makeWaveAiViewModel(blockId);
    }
    if (blockView === "cpuplot" || blockView == "sysinfo") {
        // "cpuplot" is for backwards compatibility with already-opened widgets
        return makeSysinfoViewModel(blockId, blockView);
    }
    if (blockView === "help") {
        return makeHelpViewModel(blockId, nodeModel);
    }
    return makeDefaultViewModel(blockId, blockView);
}

function getViewElem(
    blockId: string,
    blockRef: React.RefObject<HTMLDivElement>,
    contentRef: React.RefObject<HTMLDivElement>,
    blockView: string,
    viewModel: ViewModel
): JSX.Element {
    if (isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (blockView === "term") {
        return <TerminalView key={blockId} blockId={blockId} model={viewModel as TermViewModel} />;
    }
    if (blockView === "preview") {
        return (
            <PreviewView
                key={blockId}
                blockId={blockId}
                blockRef={blockRef}
                contentRef={contentRef}
                model={viewModel as PreviewModel}
            />
        );
    }
    if (blockView === "plot") {
        return <PlotView key={blockId} />;
    }
    if (blockView === "web") {
        return <WebView key={blockId} blockId={blockId} model={viewModel as WebViewModel} />;
    }
    if (blockView === "waveai") {
        return <WaveAi key={blockId} blockId={blockId} model={viewModel as WaveAiModel} />;
    }
    if (blockView === "cpuplot" || blockView === "sysinfo") {
        // "cpuplot" is for backwards compatibility with already opened widgets
        return <SysinfoView key={blockId} blockId={blockId} model={viewModel as SysinfoViewModel} />;
    }
    if (blockView == "help") {
        return <HelpView key={blockId} model={viewModel as HelpViewModel} />;
    }
    if (blockView == "tips") {
        return <QuickTipsView key={blockId} model={viewModel as QuickTipsViewModel} />;
    }
    return <CenteredDiv>Invalid View "{blockView}"</CenteredDiv>;
}

function makeDefaultViewModel(blockId: string, viewType: string): ViewModel {
    const blockDataAtom = getWaveObjectAtom<Block>(makeORef("block", blockId));
    let viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToIcon(blockData?.meta?.view);
        }),
        viewName: atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToName(blockData?.meta?.view);
        }),
        preIconButton: atom(null),
        endIconButtons: atom(null),
    };
    return viewModel;
}

const BlockPreview = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const [blockData] = useWaveObjectValue<Block>(makeORef("block", nodeModel.blockId));
    if (!blockData) {
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

const BlockFull = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const focusElemRef = useRef<HTMLInputElement>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = useState(false);
    const [blockData] = useWaveObjectValue<Block>(makeORef("block", nodeModel.blockId));
    const isFocused = useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = useAtomValue(nodeModel.disablePointerEvents);
    const innerRect = useDebouncedNodeInnerRect(nodeModel);

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
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockData?.meta?.view, viewModel),
        [nodeModel.blockId, blockData?.meta?.view, viewModel]
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
    }, []);

    const blockModel: BlockComponentModel2 = {
        onClick: setBlockClickedTrue,
        onFocusCapture: handleChildFocus,
        blockRef: blockRef,
    };

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
            <div key="content" className="block-content" ref={contentRef} style={blockContentStyle}>
                <ErrorBoundary>
                    <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const Block = memo((props: BlockProps) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel.blockId.substring(0, 8));
    const [blockData, loading] = useWaveObjectValue<Block>(makeORef("block", props.nodeModel.blockId));
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null || viewModel.viewType != blockData?.meta?.view) {
        viewModel = makeViewModel(props.nodeModel.blockId, blockData?.meta?.view, props.nodeModel);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
        };
    }, []);
    if (loading || isBlank(props.nodeModel.blockId) || blockData == null) {
        return null;
    }
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});

export { Block };
