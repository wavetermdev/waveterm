// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockComponentModel, BlockProps } from "@/app/block/blocktypes";
import { PlotView } from "@/app/view/plotview/plotview";
import { PreviewView, makePreviewModel } from "@/app/view/preview/preview";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { atoms, setBlockFocus, useBlockAtom } from "@/store/global";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import { CpuPlotView, makeCpuPlotViewModel } from "@/view/cpuplot/cpuplot";
import { HelpView } from "@/view/helpview/helpview";
import { TerminalView, makeTerminalModel } from "@/view/term/term";
import { WaveAi, makeWaveAiViewModel } from "@/view/waveai/waveai";
import { WebView, makeWebViewModel } from "@/view/webview/webview";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrame } from "./blockframe";
import { blockViewToIcon, blockViewToName } from "./blockutil";

import "./block.less";

function getViewElemAndModel(
    blockId: string,
    blockView: string,
    blockRef: React.RefObject<HTMLDivElement>
): { viewModel: ViewModel; viewElem: JSX.Element } {
    let viewElem: JSX.Element = null;
    let viewModel: ViewModel = null;
    if (util.isBlank(blockView)) {
        viewElem = <CenteredDiv>No View</CenteredDiv>;
        viewModel = makeDefaultViewModel(blockId);
    } else if (blockView === "term") {
        const termViewModel = makeTerminalModel(blockId);
        viewElem = <TerminalView key={blockId} blockId={blockId} model={termViewModel} />;
        viewModel = termViewModel;
    } else if (blockView === "preview") {
        const previewModel = makePreviewModel(blockId);
        viewElem = <PreviewView key={blockId} blockId={blockId} model={previewModel} />;
        viewModel = previewModel;
    } else if (blockView === "plot") {
        viewElem = <PlotView key={blockId} />;
    } else if (blockView === "web") {
        const webviewModel = makeWebViewModel(blockId);
        viewElem = <WebView key={blockId} parentRef={blockRef} model={webviewModel} />;
        viewModel = webviewModel;
    } else if (blockView === "waveai") {
        const waveAiModel = makeWaveAiViewModel(blockId);
        viewElem = <WaveAi key={blockId} model={waveAiModel} />;
        viewModel = waveAiModel;
    } else if (blockView === "cpuplot") {
        const cpuPlotModel = makeCpuPlotViewModel(blockId);
        viewElem = <CpuPlotView key={blockId} model={cpuPlotModel} />;
        viewModel = cpuPlotModel;
    } else if (blockView == "help") {
        viewElem = <HelpView key={blockId} />;
        viewModel = makeDefaultViewModel(blockId);
    }
    if (viewModel == null) {
        viewElem = <CenteredDiv>Invalid View "{blockView}"</CenteredDiv>;
        viewModel = makeDefaultViewModel(blockId);
    }
    return { viewElem, viewModel };
}

function makeDefaultViewModel(blockId: string): ViewModel {
    const blockDataAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    let viewModel: ViewModel = {
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

const BlockPreview = React.memo(({ blockId, layoutModel }: BlockProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    if (!blockData) {
        return null;
    }
    let { viewModel } = getViewElemAndModel(blockId, blockData?.meta?.view, null);
    return (
        <BlockFrame
            key={blockId}
            blockId={blockId}
            layoutModel={layoutModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockFull = React.memo(({ blockId, layoutModel }: BlockProps) => {
    const focusElemRef = React.useRef<HTMLInputElement>(null);
    const blockRef = React.useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = React.useState(false);
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const [focusedChild, setFocusedChild] = React.useState(null);
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData.activeblockid === blockId;
        });
    });
    const isFocused = jotai.useAtomValue(isFocusedAtom);

    React.useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    React.useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = blockRef.current?.contains(document.activeElement);
        if (!focusWithin) {
            setFocusTarget();
        }
        setBlockFocus(blockId);
    }, [blockClicked]);

    React.useLayoutEffect(() => {
        if (focusedChild == null) {
            return;
        }
        setBlockFocus(blockId);
    }, [focusedChild, blockId]);

    // treat the block as clicked on creation
    const setBlockClickedTrue = React.useCallback(() => {
        setBlockClicked(true);
    }, []);

    let { viewElem, viewModel } = React.useMemo(
        () => getViewElemAndModel(blockId, blockData?.meta?.view, blockRef),
        [blockId, blockData?.meta?.view, blockRef]
    );

    const determineFocusedChild = React.useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            setFocusedChild(event.target);
        },
        [setFocusedChild]
    );

    const setFocusTarget = React.useCallback(() => {
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
    }, []);

    if (!blockId || !blockData) return null;

    if (blockDataLoading) {
        viewElem = <CenteredDiv>Loading...</CenteredDiv>;
    }
    const blockModel: BlockComponentModel = {
        onClick: setBlockClickedTrue,
        onFocusCapture: determineFocusedChild,
        blockRef: blockRef,
    };

    return (
        <BlockFrame
            key={blockId}
            blockId={blockId}
            layoutModel={layoutModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input type="text" value="" ref={focusElemRef} id={`${blockId}-dummy-focus`} onChange={() => {}} />
            </div>
            <div
                key="content"
                className="block-content"
                style={{ pointerEvents: layoutModel?.disablePointerEvents ? "none" : undefined }}
            >
                <ErrorBoundary>
                    <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</React.Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const Block = React.memo((props: BlockProps) => {
    if (props.preview) {
        return <BlockPreview {...props} />;
    }
    return <BlockFull {...props} />;
});

export { Block };
