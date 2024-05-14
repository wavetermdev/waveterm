// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { atoms } from "@/store/global";

import { TerminalView } from "@/app/view/term";
import { PreviewView } from "@/app/view/preview";
import { CenteredLoadingDiv } from "@/element/quickelems";

import "./block.less";

const Block = ({ blockId }: { blockId: string }) => {
    const blockRef = React.useRef<HTMLDivElement>(null);
    const [dims, setDims] = React.useState({ width: 0, height: 0 });
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
    const blockAtom = atoms.blockAtomFamily(blockId);
    const blockData = jotai.useAtomValue(blockAtom);
    if (blockData.view === "term") {
        blockElem = <TerminalView blockId={blockId} />;
    } else if (blockData.view === "preview") {
        blockElem = <PreviewView blockId={blockId} />;
    }
    return (
        <div className="block" ref={blockRef}>
            <div key="header" className="block-header">
                <div className="text-fixed">
                    Block [{blockId.substring(0, 8)}] {dims.width}x{dims.height}
                </div>
            </div>
            <div key="content" className="block-content">
                <React.Suspense fallback={<CenteredLoadingDiv />}>{blockElem}</React.Suspense>
            </div>
        </div>
    );
};

export { Block };
