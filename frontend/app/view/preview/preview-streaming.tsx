// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CenteredDiv } from "@/app/element/quickelems";
import { globalStore } from "@/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { SpecializedViewProps } from "./preview";

function ImageZoomControls() {
    const { zoomIn, zoomOut, resetTransform } = useControls();

    return (
        <div className="absolute flex flex-row z-[2] top-0 right-0 p-[5px] gap-1">
            <Button onClick={() => zoomIn()} title="Zoom In" className="py-1 px-[5px]">
                <i className="fa-sharp fa-plus" />
            </Button>
            <Button onClick={() => zoomOut()} title="Zoom Out" className="py-1 px-[5px]">
                <i className="fa-sharp fa-minus" />
            </Button>
            <Button onClick={() => resetTransform()} title="Reset Zoom" className="py-1 px-[5px]">
                <i className="fa-sharp fa-rotate-left" />
            </Button>
        </div>
    );
}

function StreamingImagePreview({ url }: { url: string }) {
    return (
        <div className="flex flex-row h-full overflow-hidden items-center justify-center relative">
            <TransformWrapper initialScale={1} centerOnInit pinch={{ step: 10 }}>
                {({ zoomIn, zoomOut, resetTransform, ...rest }) => (
                    <>
                        <ImageZoomControls />
                        <TransformComponent wrapperClass="!h-full !w-full">
                            <img src={url} className="z-[1]" />
                        </TransformComponent>
                    </>
                )}
            </TransformWrapper>
        </div>
    );
}

function StreamingPreview({ model }: SpecializedViewProps) {
    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        model.startFileWatcher();
        return () => {
            model.refreshCallback = null;
            model.stopFileWatcher();
        };
    }, []);
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
            <div className="flex flex-row h-full overflow-hidden items-center justify-center p-[5px]">
                <iframe src={streamingUrl} width="100%" height="100%" name="pdfview" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("video/")) {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center">
                <video controls className="w-full h-full p-[10px] object-contain">
                    <source src={streamingUrl} />
                </video>
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("audio/")) {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center">
                <audio controls className="w-full h-full p-[10px] object-contain">
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
