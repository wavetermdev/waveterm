// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getOverrideConfigAtom, refocusNode, getApi, getFocusedTerminalCwd } from "@/store/global";
import * as WOS from "@/store/wos";
import { goHistory, goHistoryBack, goHistoryForward } from "@/util/historyutil";
import { checkKeyPressed } from "@/util/keyutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { base64ToString, fireAndForget, isBlank, jotaiLoadableValue, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import clsx from "clsx";
import { Atom, atom, Getter, PrimitiveAtom, WritableAtom } from "jotai";
import { loadable } from "jotai/utils";
import type { ColumnSizingState, SortingState, VisibilityState } from "@tanstack/react-table";
import type * as MonacoTypes from "monaco-editor";
import { createRef } from "react";
import { PreviewView } from "./preview";
import { makeDirectoryDefaultMenuItems } from "./preview-directory-utils";
import {
    CancelledError,
    computeSpeedBps,
    createCancelToken,
    formatBytesSize,
    isDownloadFailure,
    planUploadChunks,
    raceWithCancel,
    readChunkAsBase64,
    reconcileChunkFailure,
    resolveMaxUploadSize,
    UploadChunkSize,
    UploadChunkTimeoutMs,
} from "./preview-model-upload";
import type { CancelToken, DownloadProgress, UploadProgress, UploadStatusState } from "./preview-model-upload";
import { claimDownloadProgressSlot } from "./download-progress";
import type { PreviewEnv } from "./previewenv";

// TODO drive this using config
const BOOKMARKS: { label: string; path: string }[] = [
    { label: "Home", path: "~" },
    { label: "Desktop", path: "~/Desktop" },
    { label: "Downloads", path: "~/Downloads" },
    { label: "Documents", path: "~/Documents" },
    { label: "Root", path: "/" },
];

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

const textApplicationMimetypes = [
    "application/sql",
    "application/x-php",
    "application/x-pem-file",
    "application/x-httpd-php",
    "application/liquid",
    "application/graphql",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/x-typescript",
    "application/dart",
    "application/vnd.dart",
    "application/x-ruby",
    "application/sql",
    "application/wasm",
    "application/x-latex",
    "application/x-sh",
    "application/x-python",
    "application/x-awk",
];

function isTextFile(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("text/") ||
        textApplicationMimetypes.includes(mimeType) ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType.includes("xml")
    );
}

function isStreamingType(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    );
}

function isMarkdownLike(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx");
}

function iconForFile(mimeType: string): string {
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
    } else if (isMarkdownLike(mimeType)) {
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
    } else {
        return "file";
    }
}

export class PreviewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    noPadding?: Atom<boolean>;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    preIconButton: Atom<IconButtonDecl>;
    endIconButtons: Atom<IconButtonDecl[]>;
    hideViewName: Atom<boolean>;
    previewTextRef: React.RefObject<HTMLDivElement>;
    editMode: Atom<boolean>;
    canPreview: PrimitiveAtom<boolean>;
    specializedView: Atom<Promise<{ specializedView?: string; errorStr?: string }>>;
    loadableSpecializedView: Atom<Loadable<{ specializedView?: string; errorStr?: string }>>;
    manageConnection: Atom<boolean>;
    connStatus: Atom<ConnStatus>;
    filterOutNowsh?: Atom<boolean>;

    metaFilePath: Atom<string>;
    statFilePath: Atom<Promise<string>>;
    loadableFileInfo: Atom<Loadable<FileInfo>>;
    connection: Atom<Promise<string>>;
    connectionImmediate: Atom<string>;
    statFile: Atom<Promise<FileInfo>>;
    fullFile: Atom<Promise<FileData>>;
    fileMimeType: Atom<Promise<string>>;
    fileMimeTypeLoadable: Atom<Loadable<string>>;
    fileContentSaved: PrimitiveAtom<string | null>;
    fileContent: WritableAtom<Promise<string>, [string], void>;
    newFileContent: PrimitiveAtom<string | null>;
    connectionError: PrimitiveAtom<string>;
    errorMsgAtom: PrimitiveAtom<ErrorMsg>;

    openFileModal: PrimitiveAtom<boolean>;
    openFileModalDelay: PrimitiveAtom<boolean>;
    openFileError: PrimitiveAtom<string>;
    openFileModalGiveFocusRef: React.RefObject<() => boolean>;

    markdownShowToc: PrimitiveAtom<boolean>;

    monacoRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    showHiddenFiles: PrimitiveAtom<boolean>;
    refreshVersion: PrimitiveAtom<number>;
    directorySearchActive: PrimitiveAtom<boolean>;
    directoryDropdownOpen: PrimitiveAtom<boolean>;
    directorySorting: PrimitiveAtom<SortingState>;
    dragSource: PrimitiveAtom<DragSourceState | null>;
    selectedPaths: PrimitiveAtom<Set<string>>;
    selectionAnchor: PrimitiveAtom<string | null>;
    fileClipboard: PrimitiveAtom<FileClipboardState | null>;
    directorySelectablePaths: PrimitiveAtom<string[]>;
    directoryColumnSizing: PrimitiveAtom<ColumnSizingState>;
    directoryColumnVisibility: PrimitiveAtom<VisibilityState>;
    uploadProgress: PrimitiveAtom<UploadProgress | null>;
    downloadProgress: PrimitiveAtom<DownloadProgress | null>;
    uploadCancel: PrimitiveAtom<CancelToken | null>;
    uploadStatus: PrimitiveAtom<UploadStatusState | null>;
    directoryKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    codeEditKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    env: PreviewEnv;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.viewType = "preview";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        // Fork decision: remote-dev dotfiles are noise, so hidden files are
        // hidden by default. Explicit user toggles still persist via the
        // "preview:showhiddenfiles" setting.
        let showHiddenFiles = globalStore.get(this.env.getSettingsKeyAtom("preview:showhiddenfiles")) ?? false;
        this.showHiddenFiles = atom<boolean>(showHiddenFiles);
        this.refreshVersion = atom(0);
        const defaultSort = globalStore.get(this.env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
        this.directorySorting = atom<SortingState>(
            defaultSort === "modtime" ? [{ id: "modtime", desc: true }] : [{ id: "name", desc: false }]
        );
        this.directoryColumnSizing = atom<ColumnSizingState>({});
        this.directoryColumnVisibility = atom<VisibilityState>({ path: false });
        this.dragSource = atom(null) as PrimitiveAtom<DragSourceState | null>;
        this.selectedPaths = atom<Set<string>>(new Set());
        this.selectionAnchor = atom<string | null>(null);
        this.fileClipboard = atom(null) as PrimitiveAtom<FileClipboardState | null>;
        this.directorySelectablePaths = atom<string[]>([]);
        this.uploadProgress = atom(null) as PrimitiveAtom<UploadProgress | null>;
        this.downloadProgress = atom(null) as PrimitiveAtom<DownloadProgress | null>;
        this.uploadCancel = atom(null) as PrimitiveAtom<CancelToken | null>;
        this.uploadStatus = atom(null) as PrimitiveAtom<UploadStatusState | null>;
        this.directorySearchActive = atom(false);
        this.directoryDropdownOpen = atom(false);
        this.previewTextRef = createRef();
        this.openFileModal = atom(false);
        this.openFileModalDelay = atom(false);
        this.openFileError = atom(null) as PrimitiveAtom<string>;
        this.openFileModalGiveFocusRef = createRef();
        this.manageConnection = atom(true);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.markdownShowToc = atom(false);
        this.filterOutNowsh = atom(true);
        this.monacoRef = createRef();
        this.connectionError = atom("");
        this.errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg | null>;
        this.viewIcon = atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeTypeLoadable = get(this.fileMimeTypeLoadable);
            const mimeType = jotaiLoadableValue(mimeTypeLoadable, "");
            if (mimeType == "directory") {
                return {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    longClick: (e: React.MouseEvent<any>) => {
                        const menuItems: ContextMenuItem[] = BOOKMARKS.map((bookmark) => ({
                            label: `Go to ${bookmark.label} (${bookmark.path})`,
                            click: () => this.goHistory(bookmark.path),
                        }));
                        ContextMenuModel.getInstance().showContextMenu(menuItems, e);
                    },
                };
            }
            return iconForFile(mimeType);
        });
        this.editMode = atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.edit ?? false;
        });
        this.viewName = atom("Preview");
        this.hideViewName = atom(true);
        this.viewText = atom((get) => {
            let headerPath = get(this.metaFilePath);
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return [
                    {
                        elemtype: "text",
                        text: headerPath,
                        className: "preview-filename",
                    },
                ];
            }
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const loadableFileInfo = get(this.loadableFileInfo);
            const isDirectory = loadableFileInfo.state == "hasData" && loadableFileInfo.data?.mimetype === "directory";
            if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~") {
                    headerPath = `~ (${loadableFileInfo.data?.dir + "/" + loadableFileInfo.data?.name})`;
                }
            }
            if (!isBlank(headerPath) && headerPath != "/" && headerPath.endsWith("/")) {
                headerPath = headerPath.slice(0, -1);
            }
            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: headerPath,
                    ref: this.previewTextRef,
                    className: "preview-filename",
                    onClick: () => {
                        if (isDirectory) {
                            const current = globalStore.get(this.directoryDropdownOpen);
                            globalStore.set(this.directoryDropdownOpen, !current);
                        } else {
                            this.toggleOpenFileModal();
                        }
                    },
                },
            ];
            let saveClassName = "grey";
            if (get(this.newFileContent) !== null) {
                saveClassName = "green";
            }
            if (isCeView) {
                const fileInfo = globalStore.get(this.loadableFileInfo);
                if (fileInfo.state != "hasData") {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Loading ...",
                        className: clsx(`grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else if (fileInfo.data.readonly) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Read Only",
                        className: clsx(`yellow rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Save",
                        className: clsx(`${saveClassName} rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => fireAndForget(this.handleFileSave.bind(this)),
                    });
                }
                if (get(this.canPreview)) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Preview",
                        className: "grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]",
                        onClick: () => fireAndForget(() => this.setEditMode(false)),
                    });
                }
            } else if (get(this.canPreview)) {
                viewTextChildren.push({
                    elemtype: "textbutton",
                    text: "Edit",
                    className: "grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]",
                    onClick: () => fireAndForget(() => this.setEditMode(true)),
                });
            }
            return [
                {
                    elemtype: "div",
                    children: viewTextChildren,
                },
            ] as HeaderElem[];
        });
        this.preIconButton = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const metaPath = get(this.metaFilePath);
            if (mimeType == "directory" && metaPath == "/") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.goParentDirectory.bind(this),
            };
        });
        this.endIconButtons = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const navIconButtons: IconButtonDecl[] = [
                {
                    elemtype: "iconbutton",
                    icon: "house",
                    title: "Go to Home",
                    click: () => this.goHistory("~"),
                },
                {
                    elemtype: "iconbutton",
                    icon: "terminal",
                    title: "Go to Terminal Directory",
                    click: () => this.goHistory(getFocusedTerminalCwd() ?? "~"),
                },
            ];
            const refreshIconButton: IconButtonDecl = {
                elemtype: "iconbutton",
                icon: "arrows-rotate",
                title: "Refresh",
                click: () => this.refresh(),
            };
            if (mimeType == "directory") {
                const showHiddenFiles = get(this.showHiddenFiles);
                return [
                    ...navIconButtons,
                    {
                        elemtype: "iconbutton",
                        icon: showHiddenFiles ? "eye" : "eye-slash",
                        title: showHiddenFiles ? "Hide Hidden Files" : "Show Hidden Files",
                        click: () => {
                            globalStore.set(this.showHiddenFiles, (prev) => !prev);
                        },
                    },
                    refreshIconButton,
                ] as IconButtonDecl[];
            } else if (isCeView) {
                // code edit view: add a refresh (re-read from disk) button
                return [...navIconButtons, refreshIconButton] as IconButtonDecl[];
            } else if (isMarkdownLike(mimeType)) {
                return [
                    ...navIconButtons,
                    {
                        elemtype: "iconbutton",
                        icon: "book",
                        title: "Table of Contents",
                        click: () => this.markdownShowTocToggle(),
                    },
                    refreshIconButton,
                ] as IconButtonDecl[];
            } else if (mimeType) {
                // For all other file types (csv, streaming, etc.), add refresh button
                return [...navIconButtons, refreshIconButton] as IconButtonDecl[];
            }
            return null;
        });
        this.metaFilePath = atom<string>((get) => {
            const file = get(this.blockAtom)?.meta?.file;
            if (isBlank(file)) {
                const terminalCwd = getFocusedTerminalCwd();
                return terminalCwd || "~";
            }
            return file;
        });
        this.statFilePath = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.path;
        });
        this.connection = atom<Promise<string>>(async (get) => {
            const connName = get(this.blockAtom)?.meta?.connection;
            try {
                await this.env.rpc.ConnEnsureCommand(TabRpcClient, { connname: connName, logblockid: this.blockId }, { timeout: 60000 });
                globalStore.set(this.connectionError, "");
            } catch (e) {
                globalStore.set(this.connectionError, e as string);
            }
            return connName;
        });
        this.connectionImmediate = atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const statFile = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return statFile;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });
        this.fileMimeType = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.newFileContent = atom(null) as PrimitiveAtom<string | null>;
        this.goParentDirectory = this.goParentDirectory.bind(this);

        const fullFileAtom = atom<Promise<FileData>>(async (get) => {
            get(this.refreshVersion); // Subscribe to refreshVersion to trigger re-fetch
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const file = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return file;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });

        this.fileContentSaved = atom(null) as PrimitiveAtom<string | null>;
        const fileContentAtom = atom(
            async (get) => {
                const newContent = get(this.newFileContent);
                if (newContent != null) {
                    return newContent;
                }
                const savedContent = get(this.fileContentSaved);
                if (savedContent != null) {
                    return savedContent;
                }
                const fullFile = await get(fullFileAtom);
                return base64ToString(fullFile?.data64);
            },
            (_, set, update: string) => {
                set(this.fileContentSaved, update);
            }
        );

        this.fullFile = fullFileAtom;
        this.fileContent = fileContentAtom;

        this.specializedView = atom<Promise<{ specializedView?: string; errorStr?: string }>>(async (get) => {
            return this.getSpecializedView(get);
        });
        this.loadableSpecializedView = loadable(this.specializedView);
        this.canPreview = atom(false);
        this.loadableFileInfo = loadable(this.statFile);
        this.connStatus = atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.noPadding = atom(true);
    }

    markdownShowTocToggle() {
        globalStore.set(this.markdownShowToc, !globalStore.get(this.markdownShowToc));
    }

    // Re-read the current file from disk (or re-list the current directory).
    // Clears the saved-content buffer so a previously saved file falls through
    // to a fresh read; unsaved edits (newFileContent) are left intact.
    refresh() {
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.refreshVersion, (v) => v + 1);
    }

    get viewComponent(): ViewComponent {
        return PreviewView;
    }

    async getSpecializedView(getFn: Getter): Promise<{ specializedView?: string; errorStr?: string }> {
        const mimeType = await getFn(this.fileMimeType);
        const fileInfo = await getFn(this.statFile);
        const fileName = fileInfo?.name;
        const connErr = getFn(this.connectionError);
        const editMode = getFn(this.editMode);
        const genErr = getFn(this.errorMsgAtom);

        if (!fileInfo) {
            return { errorStr: `Load Error: ${genErr?.text}` };
        }
        if (connErr != "") {
            return { errorStr: `Connection Error: ${connErr}` };
        }
        if (fileInfo?.notfound) {
            return { specializedView: "codeedit" };
        }
        if (mimeType == null) {
            return { errorStr: `Unable to determine mimetype for: ${fileInfo.path}` };
        }
        if (isStreamingType(mimeType)) {
            return { specializedView: "streaming" };
        }
        if (!fileInfo) {
            const fileNameStr = fileName ? " " + JSON.stringify(fileName) : "";
            return { errorStr: "File Not Found" + fileNameStr };
        }
        if (fileInfo.size > MaxFileSize) {
            return { errorStr: "File Too Large to Preview (10 MB Max)" };
        }
        if (mimeType == "text/csv" && fileInfo.size > MaxCSVSize) {
            return { errorStr: "CSV File Too Large to Preview (1 MB Max)" };
        }
        if (mimeType == "directory") {
            return { specializedView: "directory" };
        }
        if (mimeType == "text/csv") {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "csv" };
        }
        if (isMarkdownLike(mimeType)) {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "markdown" };
        }
        if (isTextFile(mimeType) || fileInfo.size == 0) {
            return { specializedView: "codeedit" };
        }
        return { errorStr: `Preview (${mimeType})` };
    }

    updateOpenFileModalAndError(isOpen, errorMsg = null) {
        globalStore.set(this.openFileModal, isOpen);
        globalStore.set(this.openFileError, errorMsg);
        if (isOpen) {
            globalStore.set(this.openFileModalDelay, true);
        } else {
            const delayVal = globalStore.get(this.openFileModalDelay);
            if (delayVal) {
                setTimeout(() => {
                    globalStore.set(this.openFileModalDelay, false);
                }, 200);
            }
        }
    }

    toggleOpenFileModal() {
        const modalOpen = globalStore.get(this.openFileModal);
        const delayVal = globalStore.get(this.openFileModalDelay);
        if (!modalOpen && delayVal) {
            return;
        }
        this.updateOpenFileModalAndError(!modalOpen);
    }

    async goHistory(newPath: string) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = goHistory("file", fileName, newPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);

        // Clear the saved file buffers
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.newFileContent, null);
    }

    async goParentDirectory({ fileInfo = null }: { fileInfo?: FileInfo | null }) {
        // optional parameter needed for recursive case
        const defaultFileInfo = await globalStore.get(this.statFile);
        if (fileInfo === null) {
            fileInfo = defaultFileInfo;
        }
        if (fileInfo == null) {
            this.updateOpenFileModalAndError(false);
            return true;
        }
        try {
            this.updateOpenFileModalAndError(false);
            await this.goHistory(fileInfo.dir);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", fileInfo.dir, e);
        }
    }

    async goHistoryBack() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryBack("file", curPath, blockMeta, true);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async goHistoryForward() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryForward("file", curPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async setEditMode(edit: boolean) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, { ...blockMeta, edit });
    }

    async handleFileSave() {
        const filePath = await globalStore.get(this.statFilePath);
        if (filePath == null) {
            return;
        }
        const newFileContent = globalStore.get(this.newFileContent);
        if (newFileContent == null) {
            console.log("not saving file, newFileContent is null");
            return;
        }
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: {
                    path: await this.formatRemoteUri(filePath, globalStore.get),
                },
                data64: stringToBase64(newFileContent),
            });
            globalStore.set(this.fileContent, newFileContent);
            globalStore.set(this.newFileContent, null);
            console.log("saved file", filePath);
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: "Save Failed",
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async handleFileRevert() {
        const fileContent = await globalStore.get(this.fileContent);
        this.monacoRef.current?.setValue(fileContent);
        globalStore.set(this.newFileContent, null);
    }

    async handleOpenFile(filePath: string) {
        const fileInfo = await globalStore.get(this.statFile);
        this.updateOpenFileModalAndError(false);
        if (fileInfo == null) {
            return true;
        }
        try {
            this.goHistory(filePath);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", filePath, e);
        }
    }

    isSpecializedView(sv: string): boolean {
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        return loadableSV.state == "hasData" && loadableSV.data.specializedView == sv;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const defaultFontSize = globalStore.get(this.env.getSettingsKeyAtom("editor:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["editor:fontsize"];
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: "Copy Full Path",
            click: () =>
                fireAndForget(async () => {
                    const filePath = await globalStore.get(this.statFilePath);
                    if (filePath == null) {
                        return;
                    }
                    const conn = await globalStore.get(this.connection);
                    if (conn) {
                        // remote path
                        await navigator.clipboard.writeText(formatRemoteUri(filePath, conn));
                    } else {
                        // local path
                        await navigator.clipboard.writeText(filePath);
                    }
                }),
        });
        menuItems.push({
            label: "Copy File Name",
            click: () =>
                fireAndForget(async () => {
                    const fileInfo = await globalStore.get(this.statFile);
                    if (fileInfo == null || fileInfo.name == null) {
                        return;
                    }
                    await navigator.clipboard.writeText(fileInfo.name);
                }),
        });
        menuItems.push({ type: "separator" });
        const finfo = jotaiLoadableValue(globalStore.get(this.loadableFileInfo), null);
        addOpenMenuItems(menuItems, globalStore.get(this.connectionImmediate), finfo, (remoteUri) => this.downloadFile(remoteUri));
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        const wordWrapAtom = getOverrideConfigAtom(this.blockId, "editor:wordwrap");
        const wordWrap = globalStore.get(wordWrapAtom) ?? false;
        menuItems.push({ type: "separator" });
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit") {
            const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
                (fontSize: number) => {
                    return {
                        label: fontSize.toString() + "px",
                        type: "checkbox",
                        checked: overrideFontSize == fontSize,
                        click: () => {
                            this.env.rpc.SetMetaCommand(TabRpcClient, {
                                oref: WOS.makeORef("block", this.blockId),
                                meta: { "editor:fontsize": fontSize },
                            });
                        },
                    };
                }
            );
            fontSizeSubMenu.unshift({
                label: "Default (" + defaultFontSize + "px)",
                type: "checkbox",
                checked: overrideFontSize == null,
                click: () => {
                    this.env.rpc.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "editor:fontsize": null },
                    });
                },
            });
            menuItems.push({
                label: "Editor Font Size",
                submenu: fontSizeSubMenu,
            });
            if (globalStore.get(this.newFileContent) != null) {
                menuItems.push({ type: "separator" });
                menuItems.push({
                    label: "Save File",
                    click: () => fireAndForget(this.handleFileSave.bind(this)),
                });
                menuItems.push({
                    label: "Revert File",
                    click: () => fireAndForget(this.handleFileRevert.bind(this)),
                });
            }
            menuItems.push({ type: "separator" });
            menuItems.push({
                label: "Word Wrap",
                type: "checkbox",
                checked: wordWrap,
                click: () =>
                    fireAndForget(async () => {
                        const blockOref = WOS.makeORef("block", this.blockId);
                        await this.env.services.object.UpdateObjectMeta(blockOref, {
                            "editor:wordwrap": !wordWrap,
                        });
                    }),
            });
        }
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "directory") {
            menuItems.push({ type: "separator" });
            menuItems.push({ label: "Default Settings", enabled: false });
            menuItems.push(...makeDirectoryDefaultMenuItems(this));
        }
        return menuItems;
    }

    giveFocus(): boolean {
        const openModalOpen = globalStore.get(this.openFileModal);
        if (openModalOpen) {
            this.openFileModalGiveFocusRef.current?.();
            return true;
        }
        if (this.monacoRef.current) {
            this.monacoRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:ArrowLeft")) {
            fireAndForget(this.goHistoryBack.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowRight")) {
            fireAndForget(this.goHistoryForward.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowUp")) {
            // handle up directory
            fireAndForget(() => this.goParentDirectory({}));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:o")) {
            this.toggleOpenFileModal();
            return true;
        }
        const canPreview = globalStore.get(this.canPreview);
        if (canPreview) {
            if (checkKeyPressed(e, "Cmd:e")) {
                const editMode = globalStore.get(this.editMode);
                fireAndForget(() => this.setEditMode(!editMode));
                return true;
            }
        }
        if (this.directoryKeyDownHandler) {
            const handled = this.directoryKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        if (this.codeEditKeyDownHandler) {
            const handled = this.codeEditKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        return false;
    }

    async uploadFiles(files: File[], targetDir: string) {
        // Effective per-file upload cap: 5GB by default, overridable via the
        // `files:maxuploadsize` setting (bytes). Missing/garbage/out-of-range
        // values fall back to the default (see resolveMaxUploadSize).
        const maxUploadSize = resolveMaxUploadSize(globalStore.get(this.env.getSettingsKeyAtom("files:maxuploadsize")));
        const cleanTargetDir = targetDir.replace(/\/+$/, "");
        const remoteDir = await this.formatRemoteUri(cleanTargetDir, globalStore.get);
        let successCount = 0;
        // One fresh cancellation token per uploadFiles run. Its trigger is
        // published to the uploadCancel atom so the banner's Cancel button can
        // fire it; each chunk RPC is raced against it so cancel takes effect in
        // milliseconds even while a chunk is in flight.
        const cancelToken = createCancelToken();
        globalStore.set(this.uploadCancel, cancelToken);
        // Clear any lingering transient status from a previous (cancelled) run
        // so a new upload shows its progress banner, not the old status.
        globalStore.set(this.uploadStatus, null);
        // Set when the run ends early for any reason — user cancellation or an
        // irrecoverable chunk interruption. Suppresses the success count and the
        // "Upload complete" status so a terminal status isn't clobbered.
        let stopped = false;
        try {
            for (const file of files) {
                if (stopped) {
                    break;
                }
                if (file.size > maxUploadSize) {
                    const errorStatus: ErrorMsg = {
                        status: "Upload Failed",
                        text: `File "${file.name}" exceeds ${formatBytesSize(maxUploadSize)} size limit`,
                    };
                    globalStore.set(this.errorMsgAtom, errorStatus);
                    continue;
                }
                const filePath = `${remoteDir}/${file.name}`;
                try {
                    const chunks = planUploadChunks(file.size, UploadChunkSize);
                    const startedAt = Date.now();
                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        // Read this chunk lazily via Blob.slice(...).arrayBuffer() so
                        // only ~one chunk (~3MB) of file bytes is held in memory at a
                        // time, instead of the whole file. Both the slice/encode step
                        // and the RPC are raced against cancellation.
                        const data64 = await raceWithCancel(
                            readChunkAsBase64(file, chunk.offset, chunk.length),
                            cancelToken
                        );
                        const sent = chunk.offset + chunk.length;
                        globalStore.set(this.uploadProgress, {
                            fileName: file.name,
                            sent,
                            total: file.size,
                            speedBps: computeSpeedBps(sent, startedAt, Date.now()),
                        });
                        // Send this chunk with a single automatic retry and, on a
                        // second failure, size-based reconciliation against the
                        // destination. Cancellation is raced at every step.
                        const chunkResult = await this.sendUploadChunk(filePath, data64, i === 0, sent, cancelToken);
                        if (chunkResult === "failed") {
                            // Irrecoverable: report how far we got (confirmed bytes
                            // before this chunk) and stop the whole run without
                            // deleting the partial file (the user may re-upload).
                            const pct = file.size > 0 ? Math.floor((chunk.offset / file.size) * 100) : 0;
                            this.setUploadStatus(`Upload interrupted at ${pct}%`, true);
                            stopped = true;
                            break;
                        }
                    }
                    if (!stopped) {
                        successCount++;
                    }
                } catch (e) {
                    if (e instanceof CancelledError) {
                        // User-initiated cancel: stop the whole run, best-effort
                        // delete the partial destination, and show a transient
                        // status. Not an error — no error banner, no success count.
                        this.setUploadStatus("Upload cancelled", false);
                        stopped = true;
                        try {
                            await this.env.rpc.FileDeleteCommand(TabRpcClient, {
                                path: filePath,
                                recursive: false,
                            });
                        } catch (_deleteErr) {
                            // Best-effort cleanup: the in-flight append may still
                            // land server-side after we return, but a failed delete
                            // leaves the partial file for the user to remove.
                        }
                        break;
                    }
                    const errorStatus: ErrorMsg = {
                        status: "Upload Failed",
                        text: `Failed to upload "${file.name}": ${e}`,
                    };
                    globalStore.set(this.errorMsgAtom, errorStatus);
                } finally {
                    globalStore.set(this.uploadProgress, null);
                }
            }
        } finally {
            globalStore.set(this.uploadCancel, null);
        }
        if (successCount > 0 && !stopped) {
            // Brief terminal confirmation after the last successful file, then
            // re-read the directory so the new files appear. Skipped when the run
            // stopped early (cancelled or interrupted) so that status stays visible.
            this.setUploadStatus("Upload complete", false);
            this.refresh();
        }
    }

    // Sends one upload chunk — FileWriteCommand (truncate) for the first chunk,
    // FileAppendCommand (O_APPEND) for the rest — each raced against
    // cancellation. On a non-cancelled failure the chunk is retried once; if the
    // retry also fails, the destination is statted and reconciled against the
    // expected bytes sent so far (see reconcileChunkFailure). Returns:
    //   - "ok"        the write/append succeeded (or was delivered on retry)
    //   - "delivered" both attempts failed but the remote size proves the bytes
    //                 actually landed (lost-ACK) — safe to continue
    //   - "failed"    irrecoverable — caller should abort the upload cleanly
    // Cancellation always wins: CancelledError is rethrown from every step.
    async sendUploadChunk(
        filePath: string,
        data64: string,
        isFirstChunk: boolean,
        expectedSent: number,
        cancelToken: CancelToken
    ): Promise<"ok" | "delivered" | "failed"> {
        const send = () =>
            isFirstChunk
                ? this.env.rpc.FileWriteCommand(
                      TabRpcClient,
                      { info: { path: filePath }, data64 },
                      { timeout: UploadChunkTimeoutMs }
                  )
                : this.env.rpc.FileAppendCommand(
                      TabRpcClient,
                      { info: { path: filePath }, data64 },
                      { timeout: UploadChunkTimeoutMs }
                  );
        try {
            await raceWithCancel(send(), cancelToken);
            return "ok";
        } catch (e) {
            if (e instanceof CancelledError) {
                throw e;
            }
            // fall through to the single retry
        }
        try {
            await raceWithCancel(send(), cancelToken);
            return "ok";
        } catch (e) {
            if (e instanceof CancelledError) {
                throw e;
            }
            // retry also failed — reconcile against the remote size
        }
        let remoteSize: number | null = null;
        try {
            const stat = await raceWithCancel(
                this.env.rpc.FileInfoCommand(
                    TabRpcClient,
                    { info: { path: filePath } },
                    { timeout: UploadChunkTimeoutMs }
                ),
                cancelToken
            );
            remoteSize = stat?.size ?? null;
        } catch (e) {
            if (e instanceof CancelledError) {
                throw e;
            }
            // Stat itself errored: treat as failed rather than guessing.
            return "failed";
        }
        return reconcileChunkFailure(remoteSize, expectedSent);
    }

    // Shows a terminal banner status for an upload. Transient statuses
    // (success/cancelled) clear themselves after a short delay; persistent
    // statuses (failures/interruptions) stay visible until the user dismisses
    // them via the banner's X affordance.
    setUploadStatus(text: string, persist: boolean) {
        globalStore.set(this.uploadStatus, { text, persist });
        if (persist) {
            return;
        }
        const status = { text, persist };
        setTimeout(() => {
            // Only clear if we are still showing this same status — a new upload
            // may have started and set its own status in the meantime.
            if (globalStore.get(this.uploadStatus) === status) {
                globalStore.set(this.uploadStatus, null);
            }
        }, 3000);
    }

    downloadFile(remoteUri: string) {
        try {
            const fileName = remoteUri.split("/").at(-1) ?? remoteUri;
            // Route real download progress from Electron (emain `will-download`
            // → "download-progress" IPC) into this model's banner atom. The slot
            // is window/tab-wide and single-slot: a concurrent download from
            // another block overwrites the handler, so progress follows the most
            // recent download (documented in download-progress.ts).
            claimDownloadProgressSlot((progress) => {
                globalStore.set(this.downloadProgress, progress);
                if (progress.done != null && !isDownloadFailure(progress.done)) {
                    // Brief terminal status ("Download complete"/"Download
                    // cancelled"), then clear. Failures ("Download failed"/
                    // interrupted) persist until dismissed via the banner's X.
                    // The reference-equality guard ensures a newer download's
                    // progress isn't cleared by a stale timer.
                    const terminal = progress;
                    setTimeout(() => {
                        if (globalStore.get(this.downloadProgress) === terminal) {
                            globalStore.set(this.downloadProgress, null);
                        }
                    }, 3000);
                }
            });
            // Initial indeterminate state until the first progress event lands.
            globalStore.set(this.downloadProgress, { fileName, sent: 0, total: 0 });
            getApi().downloadFile(remoteUri);
        } catch (e) {
            globalStore.set(this.downloadProgress, null);
            const errorStatus: ErrorMsg = {
                status: "Download Failed",
                text: `Failed to download: ${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async formatRemoteUri(path: string, get: Getter): Promise<string> {
        return formatRemoteUri(path, await get(this.connection));
    }

    onHide() {
        // No polling to pause; nothing to do for preview.
    }

    onShow() {
        // Trigger re-fetch of current file/directory by bumping refreshVersion.
        // The fileContent atom subscribes to refreshVersion and will re-fetch.
        globalStore.set(this.refreshVersion, globalStore.get(this.refreshVersion) + 1);
    }
}
