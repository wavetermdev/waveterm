// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/element/markdown";
import { getBackendHostPort, getObjectId, globalStore, useBlockAtom } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { loadable } from "jotai/utils";
import { useRef } from "react";
import { CenteredDiv } from "../element/quickelems";
import { CodeEdit } from "./codeedit";
import { CSVView } from "./csvview";
import { DirectoryPreview } from "./directorypreview";

import "./view.less";

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

export class PreviewModel implements ViewModel {
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    hasBackButton: jotai.Atom<boolean>;
    hasForwardButton: jotai.Atom<boolean>;
    hasSearch: jotai.Atom<boolean>;

    fileName: jotai.WritableAtom<string, [string], void>;
    statFile: jotai.Atom<Promise<FileInfo>>;
    fullFile: jotai.Atom<Promise<FullFile>>;
    fileMimeType: jotai.Atom<Promise<string>>;
    fileMimeTypeLoadable: jotai.Atom<Loadable<string>>;
    fileContent: jotai.Atom<Promise<string>>;

    setPreviewFileName(fileName: string) {
        services.ObjectService.UpdateObjectMeta(`block:${this.blockId}`, { file: fileName });
    }

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom((get) => {
            let blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const fileName = get(this.fileName);
            return iconForFile(mimeType, fileName);
        });
        this.viewName = jotai.atom("Preview");
        this.viewText = jotai.atom((get) => {
            return get(this.fileName);
        });
        this.hasBackButton = jotai.atom(true);
        this.hasForwardButton = jotai.atom((get) => {
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            if (mimeType == "directory") {
                return true;
            }
            return false;
        });
        this.hasSearch = jotai.atom(false);

        this.fileName = jotai.atom<string, [string], void>(
            (get) => {
                return get(this.blockAtom)?.meta?.file;
            },
            (get, set, update) => {
                services.ObjectService.UpdateObjectMeta(`block:${blockId}`, { file: update });
            }
        );
        this.statFile = jotai.atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.fileName);
            if (fileName == null) {
                return null;
            }
            // const statFile = await FileService.StatFile(fileName);
            console.log("PreviewModel calling StatFile", fileName);
            const statFile = await services.FileService.StatFile(fileName);
            return statFile;
        });
        this.fullFile = jotai.atom<Promise<FullFile>>(async (get) => {
            const fileName = get(this.fileName);
            if (fileName == null) {
                return null;
            }
            // const file = await FileService.ReadFile(fileName);
            const file = await services.FileService.ReadFile(fileName);
            return file;
        });
        this.fileMimeType = jotai.atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.fileContent = jotai.atom<Promise<string>>(async (get) => {
            const fullFile = await get(this.fullFile);
            return util.base64ToString(fullFile?.data64);
        });

        this.onBack = this.onBack.bind(this);
    }

    onBack() {
        const fileName = globalStore.get(this.fileName);
        if (fileName == null) {
            return;
        }
        const splitPath = fileName.split("/");
        console.log("splitPath-1", splitPath);
        splitPath.pop();
        console.log("splitPath-2", splitPath);
        const newPath = splitPath.join("/");
        globalStore.set(this.fileName, newPath);
    }
}

function makePreviewModel(blockId: string): PreviewModel {
    const previewModel = new PreviewModel(blockId);
    return previewModel;
}

function DirNav({ cwdAtom }: { cwdAtom: jotai.WritableAtom<string, [string], void> }) {
    const [cwd, setCwd] = jotai.useAtom(cwdAtom);
    if (cwd == null || cwd == "") {
        return null;
    }
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
    const streamingUrl = getBackendHostPort() + "/wave/stream-file?path=" + encodeURIComponent(filePath);
    if (fileInfo.mimetype == "application/pdf") {
        return (
            <div className="view-preview view-preview-pdf">
                <iframe src={streamingUrl} width="95%" height="95%" name="pdfview" />
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

function CodeEditPreview({
    contentAtom,
    filename,
    readonly,
}: {
    contentAtom: jotai.Atom<Promise<string>>;
    filename: string;
    readonly: boolean;
}) {
    const fileContent = jotai.useAtomValue(contentAtom);
    return <CodeEdit readonly={true} text={fileContent} filename={filename} />;
}

function CSVViewPreview({
    parentRef,
    contentAtom,
    filename,
    readonly,
}: {
    parentRef: React.MutableRefObject<HTMLDivElement>;
    contentAtom: jotai.Atom<Promise<string>>;
    filename: string;
    readonly: boolean;
}) {
    const fileContent = jotai.useAtomValue(contentAtom);
    return <CSVView parentRef={parentRef} readonly={true} content={fileContent} filename={filename} />;
}

function iconForFile(mimeType: string, fileName: string): string {
    if (mimeType == null) {
        mimeType = "unknown";
    }
    if (mimeType == "application/pdf") {
        return "file-pdf";
    } else if (mimeType.startsWith("image/")) {
        return "image";
    } else if (mimeType.startsWith("video/")) {
        return "film";
    } else if (mimeType.startsWith("audio/")) {
        return "headphones";
    } else if (mimeType.startsWith("text/markdown")) {
        return "file-lines";
    } else if (mimeType == "text/csv") {
        return "file-csv";
    } else if (
        mimeType.startsWith("text/") ||
        mimeType == "application/sql" ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml")))
    ) {
        return "file-code";
    } else if (mimeType === "directory") {
        if (fileName == "~" || fileName == "~/") {
            return "home";
        }
        return "folder-open";
    } else {
        return "file";
    }
}

function PreviewView({ blockId, model }: { blockId: string; model: PreviewModel }) {
    console.log("render previewview", getObjectId(model));
    const ref = useRef<HTMLDivElement>(null);
    const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
    const fileNameAtom = model.fileName;
    const statFileAtom = model.statFile;
    const fullFileAtom = model.fullFile;
    const fileMimeTypeAtom = model.fileMimeType;
    const fileContentAtom = model.fileContent;
    let mimeType = jotai.useAtomValue(fileMimeTypeAtom);
    if (mimeType == null) {
        mimeType = "";
    }
    let fileName = jotai.useAtomValue(fileNameAtom);
    const fileInfo = jotai.useAtomValue(statFileAtom);

    // handle streaming files here
    let specializedView: React.ReactNode;
    let blockIcon = iconForFile(mimeType, fileName);
    if (
        mimeType == "application/pdf" ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    ) {
        specializedView = <StreamingPreview fileInfo={fileInfo} />;
    } else if (fileInfo == null) {
        specializedView = (
            <CenteredDiv>File Not Found{util.isBlank(fileName) ? null : JSON.stringify(fileName)}</CenteredDiv>
        );
    } else if (fileInfo.size > MaxFileSize) {
        specializedView = <CenteredDiv>File Too Large to Preview</CenteredDiv>;
    } else if (mimeType === "text/markdown") {
        specializedView = <MarkdownPreview contentAtom={fileContentAtom} />;
    } else if (mimeType === "text/csv") {
        if (fileInfo.size > MaxCSVSize) {
            specializedView = <CenteredDiv>CSV File Too Large to Preview (1MB Max)</CenteredDiv>;
        } else {
            specializedView = (
                <CSVViewPreview parentRef={ref} contentAtom={fileContentAtom} filename={fileName} readonly={true} />
            );
        }
    } else if (
        mimeType.startsWith("text/") ||
        mimeType == "application/sql" ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml")))
    ) {
        specializedView = <CodeEditPreview readonly={true} contentAtom={fileContentAtom} filename={fileName} />;
    } else if (mimeType === "directory") {
        specializedView = <DirectoryPreview fileNameAtom={fileNameAtom} />;
    } else {
        specializedView = (
            <div className="view-preview">
                <div>Preview ({mimeType})</div>
            </div>
        );
    }
    setTimeout(() => {
        const blockIconOverrideAtom = useBlockAtom<string>(blockId, "blockicon:override", () => {
            return jotai.atom<string>(null);
        }) as jotai.PrimitiveAtom<string>;
        globalStore.set(blockIconOverrideAtom, blockIcon);
    }, 10);

    return (
        <div ref={ref} className="full-preview">
            <DirNav cwdAtom={fileNameAtom} />
            {specializedView}
        </div>
    );
}

export { PreviewView, makePreviewModel };
