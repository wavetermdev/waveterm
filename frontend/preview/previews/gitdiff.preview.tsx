// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { useRpcOverride } from "../mock/use-rpc-override";
import { DefaultGitDiffCwd, MockGitFiles, makeMockGitFileDiff, makeMockGitStatus } from "./gitdiff.preview-util";

const PreviewNodeId = "preview-gitdiff-node";

export function GitDiffPreview() {
    const env = useWaveEnv();
    const [blockId, setBlockId] = React.useState<string>(null);
    const filesRef = React.useRef([...MockGitFiles]);

    useRpcOverride("RemoteGitStatusCommand", async () => makeMockGitStatus(filesRef.current));
    useRpcOverride("RemoteGitFileDiffCommand", async (_client, data) =>
        makeMockGitFileDiff(data.path, filesRef.current)
    );
    useRpcOverride("RemoteGitRevertFileCommand", async (_client, data) => {
        filesRef.current = filesRef.current.filter((f) => f.status.path !== data.path);
    });

    React.useEffect(() => {
        env.createBlock({ meta: { view: "gitdiff", file: DefaultGitDiffCwd } }, false, false).then((id) =>
            setBlockId(id)
        );
    }, []);

    const nodeModel = React.useMemo(
        () => (blockId != null ? makeMockNodeModel({ nodeId: PreviewNodeId, blockId }) : null),
        [blockId]
    );

    if (blockId == null || nodeModel == null) {
        return null;
    }

    return (
        <div className="flex w-full max-w-[1120px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">full gitdiff block (mock WOS + mock git RPCs)</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[720px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
