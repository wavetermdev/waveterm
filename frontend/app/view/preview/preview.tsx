// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { Markdown } from "@/element/markdown";
import { createBlock, globalStore, useBlockAtom } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { getWebServerEndpoint } from "@/util/endpoints";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { loadable } from "jotai/utils";
import { useEffect, useRef } from "react";
import { CenteredDiv } from "../../element/quickelems";
import { CodeEditor } from "../codeeditor/codeeditor";
import { CSVView } from "./csvview";
import { DirectoryPreview } from "./directorypreview";

import "./preview.less";

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

function isTextFile(mimeType: string): boolean {
    return (
        mimeType.startsWith("text/") ||
        mimeType == "application/sql" ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType == "application/pem-certificate-chain"
    );
}

export class PreviewModel implements ViewModel {
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string | HeaderIconButton>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    preIconButton: jotai.Atom<HeaderIconButton>;
    endIconButtons: jotai.Atom<HeaderIconButton[]>;
    ceReadOnly: jotai.PrimitiveAtom<boolean>;
    isCeView: jotai.PrimitiveAtom<boolean>;

    fileName: jotai.WritableAtom<string, [string], void>;
    connection: jotai.Atom<string>;
    statFile: jotai.Atom<Promise<FileInfo>>;
    fullFile: jotai.Atom<Promise<FullFile>>;
    fileMimeType: jotai.Atom<Promise<string>>;
    fileMimeTypeLoadable: jotai.Atom<Loadable<string>>;
    fileContent: jotai.Atom<Promise<string>>;
    newFileContent: jotai.PrimitiveAtom<string | null>;

    showHiddenFiles: jotai.PrimitiveAtom<boolean>;
    refreshVersion: jotai.PrimitiveAtom<number>;
    refreshCallback: () => void;
    directoryInputElem: HTMLInputElement;

    setPreviewFileName(fileName: string) {
        services.ObjectService.UpdateObjectMeta(`block:${this.blockId}`, { file: fileName });
    }

    constructor(blockId: string) {
        this.blockId = blockId;
        this.showHiddenFiles = jotai.atom(true);
        this.refreshVersion = jotai.atom(0);
        this.ceReadOnly = jotai.atom(true);
        this.isCeView = jotai.atom(false);
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom((get) => {
            let blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            if (mimeType == "directory") {
                return {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    longClick: (e: React.MouseEvent<any>) => {
                        let menuItems: ContextMenuItem[] = [];
                        menuItems.push({ label: "Go to Home", click: () => globalStore.set(this.fileName, "~") });
                        menuItems.push({
                            label: "Go to Desktop",
                            click: () => globalStore.set(this.fileName, "~/Desktop"),
                        });
                        menuItems.push({
                            label: "Go to Downloads",
                            click: () => globalStore.set(this.fileName, "~/Downloads"),
                        });
                        menuItems.push({
                            label: "Go to Documents",
                            click: () => globalStore.set(this.fileName, "~/Documents"),
                        });
                        menuItems.push({ label: "Go to Root", click: () => globalStore.set(this.fileName, "/") });
                        ContextMenuModel.showContextMenu(menuItems, e);
                    },
                };
            }
            const fileName = get(this.fileName);
            return iconForFile(mimeType, fileName);
        });
        this.viewName = jotai.atom("Preview");
        this.viewText = jotai.atom((get) => {
            if (get(this.isCeView)) {
                const viewTextChildren: HeaderElem[] = [
                    {
                        elemtype: "input",
                        value: get(this.fileName),
                        isDisabled: true,
                    },
                ];
                if (get(this.ceReadOnly) == false) {
                    let saveClassName = "secondary";
                    if (get(this.newFileContent) !== null) {
                        saveClassName = "primary";
                    }
                    viewTextChildren.push(
                        {
                            elemtype: "textbutton",
                            text: "Save",
                            className: clsx(
                                `${saveClassName} warning border-radius-4 vertical-padding-2 horizontal-padding-10`
                            ),
                            onClick: this.handleFileSave.bind(this),
                        },
                        {
                            elemtype: "textbutton",
                            text: "Cancel",
                            className: "secondary border-radius-4 vertical-padding-2 horizontal-padding-10",
                            onClick: () => this.toggleCodeEditorReadOnly(true),
                        }
                    );
                } else {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Edit",
                        className: "secondary border-radius-4 vertical-padding-2 horizontal-padding-10",
                        onClick: () => this.toggleCodeEditorReadOnly(false),
                    });
                }
                return [
                    {
                        elemtype: "div",
                        children: viewTextChildren,
                    },
                ] as HeaderElem[];
            } else {
                return [
                    {
                        elemtype: "text",
                        text: get(this.fileName),
                    },
                ];
            }
        });

        this.preIconButton = jotai.atom((get) => {
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            if (mimeType == "directory") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.handleBack.bind(this),
            };
        });
        this.endIconButtons = jotai.atom((get) => {
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            if (mimeType == "directory") {
                let showHiddenFiles = get(this.showHiddenFiles);
                return [
                    {
                        elemtype: "iconbutton",
                        icon: showHiddenFiles ? "eye" : "eye-slash",
                        click: () => {
                            globalStore.set(this.showHiddenFiles, (prev) => !prev);
                        },
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        click: () => this.refreshCallback?.(),
                    },
                ];
            }
            return null;
        });
        this.fileName = jotai.atom<string, [string], void>(
            (get) => {
                return get(this.blockAtom)?.meta?.file;
            },
            (get, set, update) => {
                services.ObjectService.UpdateObjectMeta(`block:${blockId}`, { file: update });
            }
        );
        this.connection = jotai.atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = jotai.atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.fileName);
            if (fileName == null) {
                return null;
            }
            const conn = get(this.connection) ?? "";
            // const statFile = await FileService.StatFile(fileName);
            console.log("PreviewModel calling StatFile", conn, fileName);
            const statFile = await services.FileService.StatFile(conn, fileName);
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
        this.newFileContent = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;

        this.handleBack = this.handleBack.bind(this);
    }

    handleBack() {
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

    toggleCodeEditorReadOnly(readOnly: boolean) {
        globalStore.set(this.ceReadOnly, readOnly);
    }

    async handleFileSave() {
        const fileName = globalStore.get(this.fileName);
        const newFileContent = globalStore.get(this.newFileContent);
        try {
            services.FileService.SaveFile(fileName, util.stringToBase64(newFileContent));
            globalStore.set(this.newFileContent, null);
        } catch (error) {
            console.error("Error saving file:", error);
        }
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: "Copy Full Path",
            click: () => {
                const fileName = globalStore.get(this.fileName);
                if (fileName == null) {
                    return;
                }
                navigator.clipboard.writeText(fileName);
            },
        });
        menuItems.push({
            label: "Copy File Name",
            click: () => {
                let fileName = globalStore.get(this.fileName);
                if (fileName == null) {
                    return;
                }
                if (fileName.endsWith("/")) {
                    fileName = fileName.substring(0, fileName.length - 1);
                }
                const splitPath = fileName.split("/");
                const baseName = splitPath[splitPath.length - 1];
                navigator.clipboard.writeText(baseName);
            },
        });
        const mimeType = util.jotaiLoadableValue(globalStore.get(this.fileMimeTypeLoadable), "");
        if (mimeType == "directory") {
            menuItems.push({
                label: "Open Terminal in New Block",
                click: async () => {
                    const termBlockDef: BlockDef = {
                        meta: {
                            view: "term",
                            controller: "shell",
                            "cmd:cwd": globalStore.get(this.fileName),
                        },
                    };
                    await createBlock(termBlockDef);
                },
            });
        }
        return menuItems;
    }

    giveFocus(): boolean {
        if (this.directoryInputElem) {
            this.directoryInputElem.focus({ preventScroll: true });
            return true;
        }
        return false;
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
    const streamingUrl = getWebServerEndpoint() + "/wave/stream-file?path=" + encodeURIComponent(filePath);
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
    parentRef,
    contentAtom,
    filename,
    readonly,
    isCeViewAtom,
    newFileContentAtom,
    model,
}: {
    parentRef: React.MutableRefObject<HTMLDivElement>;
    contentAtom: jotai.Atom<Promise<string>>;
    filename: string;
    readonly: boolean;
    isCeViewAtom: jotai.PrimitiveAtom<boolean>;
    newFileContentAtom: jotai.PrimitiveAtom<string>;
    model: PreviewModel;
}) {
    const fileContent = jotai.useAtomValue(contentAtom);
    const setIsCeView = jotai.useSetAtom(isCeViewAtom);
    const setNewFileContent = jotai.useSetAtom(newFileContentAtom);

    useEffect(() => {
        setIsCeView(true);
        return () => {
            setIsCeView(false);
        };
    }, [setIsCeView]);

    return (
        <CodeEditor
            parentRef={parentRef}
            readonly={readonly}
            text={fileContent}
            filename={filename}
            onChange={(text) => setNewFileContent(text)}
            onSave={() => model.handleFileSave()}
            onCancel={() => model.toggleCodeEditorReadOnly(true)}
            onEdit={() => model.toggleCodeEditorReadOnly(false)}
        />
    );
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
    const contentRef = useRef<HTMLDivElement>(null);
    const fileNameAtom = model.fileName;
    const statFileAtom = model.statFile;
    const fileMimeTypeAtom = model.fileMimeType;
    const fileContentAtom = model.fileContent;
    const newFileContentAtom = model.newFileContent;
    const ceReadOnlyAtom = model.ceReadOnly;
    const isCeViewAtom = model.isCeView;

    const mimeType = jotai.useAtomValue(fileMimeTypeAtom) || "";
    const fileName = jotai.useAtomValue(fileNameAtom);
    const fileInfo = jotai.useAtomValue(statFileAtom);
    const ceReadOnly = jotai.useAtomValue(ceReadOnlyAtom);
    let blockIcon = iconForFile(mimeType, fileName);

    // ensure consistent hook calls
    const specializedView = (() => {
        let view: React.ReactNode = null;
        blockIcon = iconForFile(mimeType, fileName);
        if (
            mimeType === "application/pdf" ||
            mimeType.startsWith("video/") ||
            mimeType.startsWith("audio/") ||
            mimeType.startsWith("image/")
        ) {
            view = <StreamingPreview fileInfo={fileInfo} />;
        } else if (!fileInfo) {
            view = <CenteredDiv>File Not Found{util.isBlank(fileName) ? null : JSON.stringify(fileName)}</CenteredDiv>;
        } else if (fileInfo.size > MaxFileSize) {
            view = <CenteredDiv>File Too Large to Preview</CenteredDiv>;
        } else if (mimeType === "text/markdown") {
            view = <MarkdownPreview contentAtom={fileContentAtom} />;
        } else if (mimeType === "text/csv") {
            if (fileInfo.size > MaxCSVSize) {
                view = <CenteredDiv>CSV File Too Large to Preview (1MB Max)</CenteredDiv>;
            } else {
                view = (
                    <CSVViewPreview
                        parentRef={contentRef}
                        contentAtom={fileContentAtom}
                        filename={fileName}
                        readonly={true}
                    />
                );
            }
        } else if (isTextFile(mimeType)) {
            view = (
                <CodeEditPreview
                    readonly={ceReadOnly}
                    parentRef={contentRef}
                    contentAtom={fileContentAtom}
                    filename={fileName}
                    isCeViewAtom={isCeViewAtom}
                    newFileContentAtom={newFileContentAtom}
                    model={model}
                />
            );
        } else if (mimeType === "directory") {
            view = <DirectoryPreview fileNameAtom={fileNameAtom} model={model} />;
        } else {
            view = (
                <div className="view-preview">
                    <div>Preview ({mimeType})</div>
                </div>
            );
        }
        return view;
    })();

    useEffect(() => {
        const blockIconOverrideAtom = useBlockAtom<string>(blockId, "blockicon:override", () => {
            return jotai.atom<string>(null);
        }) as jotai.PrimitiveAtom<string>;
        globalStore.set(blockIconOverrideAtom, blockIcon);
    }, [blockId, blockIcon]);

    return (
        <div className="full-preview scrollbar-hide-until-hover">
            <div ref={contentRef} className="full-preview-content">
                {specializedView}
            </div>
        </div>
    );
}

export { makePreviewModel, PreviewView };
