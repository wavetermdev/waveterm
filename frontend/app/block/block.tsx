// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CodeEdit } from "@/app/view/codeedit";
import { PlotView } from "@/app/view/plotview";
import { PreviewView } from "@/app/view/preview";
import { TerminalView } from "@/app/view/term";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import * as WOS from "@/store/wos";
import * as React from "react";

import "./block.less";

interface BlockProps {
    blockId: string;
    onClose?: () => void;
}

const BlockHeader = ({ blockId, onClose }: BlockProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));

    return (
        <div key="header" className="block-header">
            <div className="block-header-text text-fixed">
                Block [{blockId.substring(0, 8)}] {blockData?.view}
            </div>
            {onClose && (
                <div className="close-button" onClick={onClose}>
                    <i className="fa fa-solid fa-xmark-large" />
                </div>
            )}
        </div>
    );
};

const Block = ({ blockId, onClose }: BlockProps) => {
    const blockRef = React.useRef<HTMLDivElement>(null);

    let blockElem: JSX.Element = null;
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    if (!blockId || !blockData) return null;
    if (blockDataLoading) {
        blockElem = <CenteredDiv>Loading...</CenteredDiv>;
    } else if (blockData.view === "term") {
        blockElem = <TerminalView blockId={blockId} />;
    } else if (blockData.view === "preview") {
        blockElem = <PreviewView blockId={blockId} />;
    } else if (blockData.view === "plot") {
        blockElem = <PlotView />;
    } else if (blockData.view === "codeedit") {
        blockElem = <CodeEdit text={null} />;
    }
    return (
        <div className="block" ref={blockRef}>
            <BlockHeader blockId={blockId} onClose={onClose} />
            <div key="content" className="block-content">
                <ErrorBoundary>
                    <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{blockElem}</React.Suspense>
                </ErrorBoundary>
            </div>
        </div>
    );
};

export { Block, BlockHeader };
