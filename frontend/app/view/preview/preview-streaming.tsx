// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CenteredDiv } from "@/app/element/quickelems";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import { useAtomValue } from "jotai";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { SpecializedViewProps } from "./preview";

function ImageZoomControls() {
    const { zoomIn, zoomOut, resetTransform } = useControls();

    return (
        <div className="tools">
            <Button onClick={() => zoomIn()} title="Zoom In">
                <i className="fa-sharp fa-plus" />
            </Button>
            <Button onClick={() => zoomOut()} title="Zoom Out">
                <i className="fa-sharp fa-minus" />
            </Button>
            <Button onClick={() => resetTransform()} title="Reset Zoom">
                <i className="fa-sharp fa-rotate-left" />
            </Button>
        </div>
    );
}

function StreamingImagePreview({ url }: { url: string }) {
    return (
        <div className="view-preview view-preview-image">
            <TransformWrapper initialScale={1} centerOnInit pinch={{ step: 10 }}>
                {({ zoomIn, zoomOut, resetTransform, ...rest }) => (
                    <>
                        <ImageZoomControls />
                        <TransformComponent>
                            <img src={url} />
                        </TransformComponent>
                    </>
                )}
            </TransformWrapper>
        </div>
    );
}

function StreamingPreview({ model }: SpecializedViewProps) {
    const conn = useAtomValue(model.connection);
    const fileInfo = useAtomValue(model.statFile);
    const filePath = fileInfo.path;
    const remotePath = formatRemoteUri(filePath, conn);
    const usp = new URLSearchParams();
    usp.set("path", remotePath);
    if (conn != null) {
        usp.set("connection", conn);
    }
    const streamingUrl = `${getWebServerEndpoint()}/wave/stream-file?${usp.toString()}`;
    if (fileInfo.mimetype === "application/pdf") {
        return (
            <div className="view-preview view-preview-pdf">
                <iframe src={streamingUrl} width="100%" height="100%" name="pdfview" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("video/")) {
        return (
            <div className="view-preview view-preview-video">
                <video controls>
                    <source src={streamingUrl} />
                </video>
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("audio/")) {
        return (
            <div className="view-preview view-preview-audio">
                <audio controls>
                    <source src={streamingUrl} />
                </audio>
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("image/")) {
        return <StreamingImagePreview url={streamingUrl} />;
    }
    return <CenteredDiv>Preview Not Supported</CenteredDiv>;
}

export { StreamingPreview };
