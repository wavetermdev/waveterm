// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { atoms, blockDataMap, useBlockAtom } from "@/store/global";
import { Markdown } from "@/element/markdown";
import { FileService, FileInfo, FullFile } from "@/bindings/fileservice";
import * as util from "@/util/util";
import { CenteredDiv } from "../element/quickelems";

import "./view.less";

const MaxFileSize = 1024 * 1024 * 10; // 10MB

function MarkdownPreview({ contentAtom }: { contentAtom: jotai.Atom<Promise<string>> }) {
    const readmeText = jotai.useAtomValue(contentAtom);
    return (
        <div className="view-preview view-preview-markdown">
            <Markdown text={readmeText} />
        </div>
    );
}

function StreamingPreview({ fileInfo }: { fileInfo: FileInfo }) {
    const filePath = fileInfo.path;
    const streamingUrl = "/wave/stream-file?path=" + encodeURIComponent(filePath);
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
        return (
            <div className="view-preview view-preview-image">
                <img src={streamingUrl} />
            </div>
        );
    }
    return <CenteredDiv>Preview Not Supported</CenteredDiv>;
}

function PreviewView({ blockId }: { blockId: string }) {
    const blockDataAtom: jotai.Atom<BlockData> = blockDataMap.get(blockId);
    const fileNameAtom = useBlockAtom(blockId, "preview:filename", () =>
        jotai.atom<string>((get) => {
            return get(blockDataAtom)?.meta?.file;
        })
    );
    const statFileAtom = useBlockAtom(blockId, "preview:statfile", () =>
        jotai.atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(fileNameAtom);
            if (fileName == null) {
                return null;
            }
            const statFile = await FileService.StatFile(fileName);
            return statFile;
        })
    );
    const fullFileAtom = useBlockAtom(blockId, "preview:fullfile", () =>
        jotai.atom<Promise<FullFile>>(async (get) => {
            const fileName = get(fileNameAtom);
            if (fileName == null) {
                return null;
            }
            const file = await FileService.ReadFile(fileName);
            return file;
        })
    );
    const fileMimeTypeAtom = useBlockAtom(blockId, "preview:mimetype", () =>
        jotai.atom<Promise<string>>(async (get) => {
            const fileInfo = await get(statFileAtom);
            return fileInfo?.mimetype;
        })
    );
    const fileContentAtom = useBlockAtom(blockId, "preview:filecontent", () =>
        jotai.atom<Promise<string>>(async (get) => {
            const fullFile = await get(fullFileAtom);
            return util.base64ToString(fullFile?.data64);
        })
    );
    let mimeType = jotai.useAtomValue(fileMimeTypeAtom);
    if (mimeType == null) {
        mimeType = "";
    }
    const fileInfo = jotai.useAtomValue(statFileAtom);

    // handle streaming files here
    if (mimeType.startsWith("video/") || mimeType.startsWith("audio/") || mimeType.startsWith("image/")) {
        return <StreamingPreview fileInfo={fileInfo} />;
    }
    if (fileInfo == null) {
        return <CenteredDiv>File Not Found</CenteredDiv>;
    }
    if (fileInfo.size > MaxFileSize) {
        return <CenteredDiv>File Too Large to Preview</CenteredDiv>;
    }
    if (mimeType === "text/markdown") {
        return <MarkdownPreview contentAtom={fileContentAtom} />;
    }
    if (mimeType.startsWith("text/")) {
        return (
            <div className="view-preview view-preview-text">
                <pre>{jotai.useAtomValue(fileContentAtom)}</pre>
            </div>
        );
    }
    return (
        <div className="view-preview">
            <div>Preview ({mimeType})</div>
        </div>
    );
}

export { PreviewView };
