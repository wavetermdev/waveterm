// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockUploadStateAtom } from "@/app/store/global";
import { NodeModel } from "@/layout/index";
import * as jotai from "jotai";
import * as React from "react";
import { uploadPercent } from "@/app/view/preview/preview-model-upload";
import { BlockOverlay } from "./blockoverlay";

interface UploadOverlayProps {
    nodeModel: NodeModel;
}

export const UploadOverlay = React.memo(({ nodeModel }: UploadOverlayProps) => {
    const uploadAtom = React.useMemo(() => getBlockUploadStateAtom(nodeModel.blockId), [nodeModel.blockId]);
    const uploadState = jotai.useAtomValue(uploadAtom);

    if (!uploadState?.active) {
        return null;
    }

    const isError = uploadState.error != null && uploadState.error.length > 0;
    const pct =
        !isError && uploadState.sent != null ? uploadPercent(uploadState.sent, uploadState.fileSize) : null;

    return (
        <BlockOverlay>
            <i
                className={`fa-solid text-base shrink-0 ${isError ? "fa-triangle-exclamation text-red-400" : "fa-spinner fa-spin text-info"}`}
                title={isError ? "Upload failed" : "Uploading"}
            ></i>
            <div className="text-[11px] font-semibold leading-4 tracking-[0.11px] min-w-0 flex-1 break-words @max-xxs:hidden">
                {isError ? (
                    <span className="text-red-300">{uploadState.error}</span>
                ) : (
                    <span className="text-white">
                        Uploading {uploadState.fileName}
                        {pct != null ? ` — ${pct}%` : "…"}
                    </span>
                )}
            </div>
            <div className="flex-1 hidden @max-xxs:block"></div>
        </BlockOverlay>
    );
});
UploadOverlay.displayName = "UploadOverlay";
