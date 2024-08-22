// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockComponentModel, BlockProps, LayoutComponentModel } from "@/app/block/blocktypes";
import { PlotView } from "@/app/view/plotview/plotview";
import { PreviewModel, PreviewView, makePreviewModel } from "@/app/view/preview/preview";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import {
    atoms,
    counterInc,
    getViewModel,
    registerViewModel,
    setBlockFocus,
    unregisterViewModel,
    useBlockAtom,
} from "@/store/global";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import { CpuPlotView, CpuPlotViewModel, makeCpuPlotViewModel } from "@/view/cpuplot/cpuplot";
import { HelpView } from "@/view/helpview/helpview";
import { TermViewModel, TerminalView, makeTerminalModel } from "@/view/term/term";
import { WaveAi, WaveAiModel, makeWaveAiViewModel } from "@/view/waveai/waveai";
import { WebView, WebViewModel, makeWebViewModel } from "@/view/webview/webview";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrame } from "./blockframe";
import { blockViewToIcon, blockViewToName } from "./blockutil";

import "./block.less";

type FullBlockProps = {
    blockId: string;
    preview: boolean;
    layoutModel: LayoutComponentModel;
    viewModel: ViewModel;
};

function makeViewModel(blockId: string, blockView: string): ViewModel {
    if (blockView === "term") {
        return makeTerminalModel(blockId);
    }
    if (blockView === "preview") {
        return makePreviewModel(blockId);
    }
    if (blockView === "web") {
        return makeWebViewModel(blockId);
    }
    if (blockView === "waveai") {
        return makeWaveAiViewModel(blockId);
    }
    if (blockView === "cpuplot") {
        return makeCpuPlotViewModel(blockId);
    }
    return makeDefaultViewModel(blockId, blockView);
}

function getViewElem(blockId: string, blockView: string, viewModel: ViewModel): JSX.Element {
    if (util.isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (blockView === "term") {
        return <TerminalView key={blockId} blockId={blockId} model={viewModel as TermViewModel} />;
    }
    if (blockView === "preview") {
        return <PreviewView key={blockId} blockId={blockId} model={viewModel as PreviewModel} />;
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
        return <HelpView key={blockId} blockId={blockId} />;
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

const BlockPreview = React.memo(({ blockId, layoutModel, viewModel }: FullBlockProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    if (!blockData) {
        return null;
    }
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

const BlockFull = React.memo(({ blockId, layoutModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const focusElemRef = React.useRef<HTMLInputElement>(null);
    const blockRef = React.useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = React.useState(false);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
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

    let viewElem = React.useMemo(
        () => getViewElem(blockId, blockData?.meta?.view, viewModel),
        [blockId, blockData?.meta?.view, viewModel]
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
    counterInc("render-Block");
    counterInc("render-Block-" + props.blockId.substring(0, 8));
    const [blockData, loading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", props.blockId));
    let viewModel = getViewModel(props.blockId);
    if (viewModel == null || viewModel.viewType != blockData?.meta?.view) {
        viewModel = makeViewModel(props.blockId, blockData?.meta?.view);
        registerViewModel(props.blockId, viewModel);
    }
    React.useEffect(() => {
        return () => {
            unregisterViewModel(props.blockId);
        };
    }, []);
    if (loading || util.isBlank(props.blockId) || blockData == null) {
        return null;
    }
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});

export { Block };
