// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { atoms, blockDataMap } from "@/store/global";

import { TerminalView } from "@/app/view/term";
import { PreviewView } from "@/app/view/preview";
import { PlotView } from "@/app/view/plotview";
import { CenteredDiv } from "@/element/quickelems";

import "./block.less";

const Block = ({ tabId, blockId }: { tabId: string; blockId: string }) => {
    const blockRef = React.useRef<HTMLDivElement>(null);
    const [dims, setDims] = React.useState({ width: 0, height: 0 });

    function handleClose() {
        // TODO
    }

    React.useEffect(() => {
        if (!blockRef.current) {
            return;
        }
        const rect = blockRef.current.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);
        if (newWidth !== dims.width || newHeight !== dims.height) {
            setDims({ width: newWidth, height: newHeight });
        }
    }, [blockRef.current]);

    let blockElem: JSX.Element = null;
    const blockAtom = blockDataMap.get(blockId);
    const blockData = jotai.useAtomValue(blockAtom);
    if (blockData.view === "term") {
        blockElem = <TerminalView blockId={blockId} />;
    } else if (blockData.view === "preview") {
        blockElem = <PreviewView blockId={blockId} />;
    } else if (blockData.view === "plot") {
        blockElem = <PlotView />;
    }
    return (
        <div className="block" ref={blockRef}>
            <div key="header" className="block-header">
                <div className="block-header-text text-fixed">
                    Block [{blockId.substring(0, 8)}] {dims.width}x{dims.height}
                </div>
                <div className="flex-spacer" />
                <div className="close-button" onClick={() => handleClose()}>
                    <i className="fa fa-solid fa-xmark-large" />
                </div>
            </div>
            <div key="content" className="block-content">
                <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{blockElem}</React.Suspense>
            </div>
        </div>
    );
};

export { Block };
