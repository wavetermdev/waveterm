// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockComponentModel2, BlockProps } from "@/app/block/blocktypes";
import { PlotView } from "@/app/view/plotview/plotview";
import { PreviewModel, PreviewView, makePreviewModel } from "@/app/view/preview/preview";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { NodeModel, useDebouncedNodeInnerRect } from "@/layout/index";
import {
    counterInc,
    getBlockComponentModel,
    registerBlockComponentModel,
    unregisterBlockComponentModel,
} from "@/store/global";
import * as WOS from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import * as util from "@/util/util";
import { CpuPlotView, CpuPlotViewModel, makeCpuPlotViewModel } from "@/view/cpuplot/cpuplot";
import { HelpView, HelpViewModel, makeHelpViewModel } from "@/view/helpview/helpview";
import { TermViewModel, TerminalView, makeTerminalModel } from "@/view/term/term";
import { WaveAi, WaveAiModel, makeWaveAiViewModel } from "@/view/waveai/waveai";
import { WebView, WebViewModel, makeWebViewModel } from "@/view/webview/webview";
import * as jotai from "jotai";
import * as React from "react";
import { QuickTipsView, QuickTipsViewModel } from "../view/quicktipsview/quicktipsview";
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
    if (blockView === "cpuplot") {
        return makeCpuPlotViewModel(blockId);
    }
    if (blockView === "help") {
        return makeHelpViewModel(blockId);
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
    if (util.isBlank(blockView)) {
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
    if (blockView === "cpuplot") {
        return <CpuPlotView key={blockId} blockId={blockId} model={viewModel as CpuPlotViewModel} />;
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
    const blockDataAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    let viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToIcon(blockData?.meta?.view);
        }),
        viewName: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToName(blockData?.meta?.view);
        }),
        viewText: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockData?.meta?.title;
        }),
        preIconButton: jotai.atom(null),
        endIconButtons: jotai.atom(null),
    };
    return viewModel;
}

const BlockPreview = React.memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
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

const BlockFull = React.memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const focusElemRef = React.useRef<HTMLInputElement>(null);
    const blockRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = React.useState(false);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    const isFocused = jotai.useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = jotai.useAtomValue(nodeModel.disablePointerEvents);
    const innerRect = useDebouncedNodeInnerRect(nodeModel);

    React.useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    React.useLayoutEffect(() => {
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

    const setBlockClickedTrue = React.useCallback(() => {
        setBlockClicked(true);
    }, []);

    const [blockContentOffset, setBlockContentOffset] = React.useState<Dimensions>();

    React.useEffect(() => {
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

    const blockContentStyle = React.useMemo<React.CSSProperties>(() => {
        const retVal: React.CSSProperties = {
            pointerEvents: disablePointerEvents ? "none" : undefined,
        };
        if (innerRect?.width && innerRect.height && blockContentOffset) {
            retVal.width = `calc(${innerRect?.width} - ${blockContentOffset.width}px)`;
            retVal.height = `calc(${innerRect?.height} - ${blockContentOffset.height}px)`;
        }
        return retVal;
    }, [innerRect, disablePointerEvents, blockContentOffset]);

    const viewElem = React.useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockData?.meta?.view, viewModel),
        [nodeModel.blockId, blockData?.meta?.view, viewModel]
    );

    const handleChildFocus = React.useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            console.log("setFocusedChild", nodeModel.blockId, getElemAsStr(event.target));
            if (!isFocused) {
                console.log("focusedChild focus", nodeModel.blockId);
                nodeModel.focusNode();
            }
        },
        [isFocused]
    );

    const setFocusTarget = React.useCallback(() => {
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
                    <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</React.Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const Block = React.memo((props: BlockProps) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel.blockId.substring(0, 8));
    const [blockData, loading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", props.nodeModel.blockId));
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null || viewModel.viewType != blockData?.meta?.view) {
        viewModel = makeViewModel(props.nodeModel.blockId, blockData?.meta?.view, props.nodeModel);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    React.useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
        };
    }, []);
    if (loading || util.isBlank(props.nodeModel.blockId) || blockData == null) {
        return null;
    }
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});

export { Block };
