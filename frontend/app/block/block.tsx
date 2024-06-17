// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CodeEdit } from "@/app/view/codeedit";
import { PlotView } from "@/app/view/plotview";
import { PreviewView } from "@/app/view/preview";
import { TerminalView } from "@/app/view/term/term";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import * as WOS from "@/store/wos";
import clsx from "clsx";
import * as React from "react";

import "./block.less";

const HoverPixels = 15;
const HoverTimeoutMs = 100;

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

const hoverStateOff = "off";
const hoverStatePending = "pending";
const hoverStateOn = "on";

const Block = ({ blockId, onClose }: BlockProps) => {
    const blockRef = React.useRef<HTMLDivElement>(null);
    const hoverState = React.useRef(hoverStateOff);
    const [showHeader, setShowHeader] = React.useState(false);

    React.useEffect(() => {
        const block = blockRef.current;
        let hoverTimeout: NodeJS.Timeout = null;
        const handleMouseMove = (event) => {
            const rect = block.getBoundingClientRect();
            if (event.clientY - rect.top <= HoverPixels) {
                if (hoverState.current == hoverStateOff) {
                    hoverTimeout = setTimeout(() => {
                        if (hoverState.current == hoverStatePending) {
                            hoverState.current = hoverStateOn;
                            setShowHeader(true);
                        }
                    }, HoverTimeoutMs);
                    hoverState.current = hoverStatePending;
                }
            } else {
                if (hoverTimeout) {
                    if (hoverState.current == hoverStatePending) {
                        hoverState.current = hoverStateOff;
                    }
                    clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
            }
        };
        block.addEventListener("mousemove", handleMouseMove);
        return () => {
            block.removeEventListener("mousemove", handleMouseMove);
        };
    });

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
        blockElem = <CodeEdit text={null} filename={null} />;
    }
    return (
        <div
            className="block"
            ref={blockRef}
            onMouseLeave={() => {
                setShowHeader(false);
                hoverState.current = hoverStateOff;
            }}
        >
            <div
                className={clsx("block-header-animation-wrap", showHeader ? "is-showing" : null)}
                onMouseLeave={() => {
                    setShowHeader(false);
                    hoverState.current = hoverStateOff;
                }}
            >
                <BlockHeader blockId={blockId} onClose={onClose} />
            </div>
            <div key="content" className="block-content">
                <ErrorBoundary>
                    <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{blockElem}</React.Suspense>
                </ErrorBoundary>
            </div>
        </div>
    );
};

export { Block, BlockHeader };
