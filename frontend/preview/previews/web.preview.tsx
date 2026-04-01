// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { WebBlockId } from "../mock/mockwaveenv";

const PreviewNodeId = "preview-web-node";

export function WebPreview() {
    const nodeModel = React.useMemo(
        () => makeMockNodeModel({ nodeId: PreviewNodeId, blockId: WebBlockId, innerRect: { width: "1040px", height: "620px" } }),
        []
    );

    return (
        <div className="flex w-full max-w-[1100px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">full web block using preview mock fallback</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[680px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
