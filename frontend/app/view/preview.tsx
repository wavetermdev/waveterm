// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FileInfo, FileService, FullFile } from "@/bindings/fileservice";
import { Markdown } from "@/element/markdown";
import { useBlockAtom, useBlockCache } from "@/store/global";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { CenteredDiv } from "../element/quickelems";
import { CodeEditView } from "./codeedit";
import { DirectoryPreview } from "./directorypreview";

import "./view.less";

const MaxFileSize = 1024 * 1024 * 10; // 10MB

function DirNav({ cwdAtom }: { cwdAtom: jotai.WritableAtom<string, [string], void> }) {
    const [cwd, setCwd] = jotai.useAtom(cwdAtom);
    let splitNav = [cwd];
    let remaining = cwd;

    let idx = remaining.lastIndexOf("/");
    while (idx !== -1) {
        remaining = remaining.substring(0, idx);
        splitNav.unshift(remaining);

        idx = remaining.lastIndexOf("/");
    }
    if (splitNav.length === 0) {
        splitNav = [cwd];
    }
    return (
        <div className="view-nav">
            {splitNav.map((item, idx) => {
                let splitPath = item.split("/");
                if (splitPath.length === 0) {
                    splitPath = [item];
                }
                const isLast = idx == splitNav.length - 1;
                let baseName = splitPath[splitPath.length - 1];
                if (!isLast) {
                    baseName += "/";
                }
                return (
                    <div
                        className={clsx("view-nav-item", isLast ? "current-file" : "clickable")}
                        key={`nav-item-${item}`}
                        onClick={isLast ? null : () => setCwd(item)}
                    >
                        {baseName}
                    </div>
                );
            })}
            <div className="flex-spacer"></div>
        </div>
    );
}

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
    if (fileInfo.mimetype == "application/pdf") {
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
        return (
            <div className="view-preview view-preview-image">
                <img src={streamingUrl} />
            </div>
        );
    }
    return <CenteredDiv>Preview Not Supported</CenteredDiv>;
}

function PreviewView({ blockId }: { blockId: string }) {
    const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
    const fileNameAtom: jotai.WritableAtom<string, [string], void> = useBlockCache(blockId, "preview:filename", () =>
        jotai.atom<string, [string], void>(
            (get) => {
                return get(blockAtom)?.meta?.file;
            },
            (get, set, update) => {
                const blockId = get(blockAtom)?.oid;
                WOS.UpdateObjectMeta(`block:${blockId}`, { file: update });
            }
        )
    );
    let name = jotai.useAtomValue(fileNameAtom);
    console.log("file: ", name);
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
    const fileContent = jotai.useAtomValue(fileContentAtom);

    // handle streaming files here
    let specializedView: React.ReactNode;
    if (
        mimeType == "application/pdf" ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    ) {
        specializedView = <StreamingPreview fileInfo={fileInfo} />;
    } else if (fileInfo == null) {
        specializedView = <CenteredDiv>File Not Found</CenteredDiv>;
    } else if (fileInfo.size > MaxFileSize) {
        specializedView = <CenteredDiv>File Too Large to Preview</CenteredDiv>;
    } else if (mimeType === "text/markdown") {
        specializedView = <MarkdownPreview contentAtom={fileContentAtom} />;
    } else if (mimeType.startsWith("text/")) {
        specializedView = (
            <div className="view-preview view-preview-text">
                <pre>{fileContent}</pre>
            </div>
        );
    } else if (
        mimeType.startsWith("application") &&
        (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))
    ) {
        specializedView = <CodeEditView readonly={true} text={fileContent} />;
    } else if (mimeType === "directory") {
        specializedView = <DirectoryPreview contentAtom={fileContentAtom} fileNameAtom={fileNameAtom} />;
    } else {
        specializedView = (
            <div className="view-preview">
                <div>Preview ({mimeType})</div>
            </div>
        );
    }

    return (
        <div className="full-preview">
            <DirNav cwdAtom={fileNameAtom} />
            {specializedView}
        </div>
    );
}

export { PreviewView };
