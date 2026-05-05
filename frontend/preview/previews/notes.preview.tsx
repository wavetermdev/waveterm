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
    const [failRead, setFailRead] = React.useState(false);
    const [failWrite, setFailWrite] = React.useState(false);
    const [blockKey, setBlockKey] = React.useState(0);

    const failReadRef = React.useRef(false);
    const failWriteRef = React.useRef(false);

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
        if (failReadRef.current) throw new Error("Permission denied: cannot read ~/notes.md");
        return { data64: stringToBase64(MockContent) };
    });

    useRpcOverride("FileWriteCommand", async () => {
        if (failWriteRef.current) throw new Error("Disk full: cannot write ~/notes.md");
        return null;
    });

    function toggleFailRead(val: boolean) {
        failReadRef.current = val;
        setFailRead(val);
        setBlockKey((k) => k + 1);
    }

    function toggleFailWrite(val: boolean) {
        failWriteRef.current = val;
        setFailWrite(val);
    }

    return (
        <div className="flex w-full max-w-[760px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">notes block (mock RPC — FileReadCommand / FileWriteCommand)</div>
            <div className="flex gap-6 text-sm mb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={failRead}
                        onChange={(e) => toggleFailRead(e.target.checked)}
                    />
                    Fail file read
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={failWrite}
                        onChange={(e) => toggleFailWrite(e.target.checked)}
                    />
                    Fail file write
                </label>
            </div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[540px]">
                    <Block key={blockKey} preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
