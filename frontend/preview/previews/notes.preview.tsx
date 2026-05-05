// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { stringToBase64 } from "@/util/util";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { NotesBlockId } from "../mock/mockwaveenv";
import { useRpcOverride } from "../mock/use-rpc-override";

const PreviewNodeId = "preview-notes-node";

const MockContent = `# My Notes

This is a **preview** of the notes view.

- Item one
- Item two
- Item three

> Autosave is debounced — changes save after 1 second of inactivity.
`;

export default function NotesPreview() {
    const nodeModel = React.useMemo(
        () =>
            makeMockNodeModel({
                nodeId: PreviewNodeId,
                blockId: NotesBlockId,
                innerRect: { width: "700px", height: "500px" },
                numLeafs: 1,
            }),
        []
    );

    useRpcOverride("FileReadCommand", async () => {
        return { data64: stringToBase64(MockContent) };
    });

    useRpcOverride("FileWriteCommand", async () => {
        return null;
    });

    return (
        <div className="flex w-full max-w-[760px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">notes block (mock RPC — FileReadCommand / FileWriteCommand)</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[540px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
