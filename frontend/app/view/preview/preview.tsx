// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TypeAheadModal } from "@/app/modals/typeaheadmodal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { tryReinjectKey } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import { Markdown } from "@/element/markdown";
import { NodeModel } from "@/layout/index";
import { atoms, createBlock, getConnStatusAtom, globalStore, refocusNode } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { getWebServerEndpoint } from "@/util/endpoints";
import * as historyutil from "@/util/historyutil";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import { makeConnRoute } from "@/util/util";
import { Monaco } from "@monaco-editor/react";
import clsx from "clsx";
import * as jotai from "jotai";
import { loadable } from "jotai/utils";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import * as React from "react";
import { createRef, useCallback, useState } from "react";
import { CenteredDiv } from "../../element/quickelems";
import { CodeEditor } from "../codeeditor/codeeditor";
import { CSVView } from "./csvview";
import { DirectoryPreview } from "./directorypreview";
import "./preview.less";

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

type SpecializedViewProps = {
    model: PreviewModel;
    parentRef: React.RefObject<HTMLDivElement>;
};

const SpecializedViewMap: { [view: string]: ({ model }: SpecializedViewProps) => React.JSX.Element } = {
    streaming: StreamingPreview,
    markdown: MarkdownPreview,
    codeedit: CodeEditPreview,
    csv: CSVViewPreview,
    directory: DirectoryPreview,
};

const textApplicationMimetypes = [
    "application/sql",
    "application/pem-certificate-chain",
    "application/x-php",
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

function canPreview(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/csv");
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
const previewTipText = `
### Preview
Preview is the generic type of block used for viewing files. This can take many different forms based on the type of file being viewed.
You can use \`wsh view [path]\` from any Wave terminal window to open a preview block with the contents of the specified path (e.g. \`wsh view .\` or \`wsh view ~/myimage.jpg\`).

#### Directory
When looking at a directory, preview will show a file viewer much like MacOS' *Finder* application or Windows' *File Explorer* application. This variant is slightly more geared toward software development with the focus on seeing what is shown by the \`ls -alh\` command.

##### View a New File
The simplest way to view a new file is to double click its row in the file viewer. Alternatively, while the block is focused, you can use the &uarr; and &darr; arrow keys to select a row and press enter to preview the associated file.

##### View the Parent Directory
In the directory view, this is as simple as opening the \`..\` file as if it were a regular file. This can be done with the method above.  You can also use the keyboard shortcut \`Cmd + ArrowUp\`.

##### Navigate Back and Forward
When looking at a file, you can navigate back by clicking the back button in the block header or the keyboard shortcut \`Cmd + ArrowLeft\`.  You can always navigate back and forward using \`Cmd + ArrowLeft\` and \`Cmd + ArrowRight\`.

##### Filter the List of Files
While the block is focused, you can filter by filename by typing a substring of the filename you're working for. To clear the filter, you can click the &#x2715; on the filter dropdown or press esc.

##### Sort by a File Column
To sort a file by a specific column, click on the header for that column. If you click the header again, it will reverse the sort order.

##### Hide and Show Hidden Files
At the right of the block header, there is an &#128065;&#65039; button. Clicking this button hides and shows hidden files.

##### Refresh the Directory
At the right of the block header, there is a refresh button. Clicking this button refreshes the directory contents.

##### Navigate to Common Directories
At the left of the block header, there is a file icon. Clicking and holding on this icon opens a menu where you can select a common folder to navigate to. The available options are *Home*, *Desktop*, *Downloads*, and *Root*.

##### Open a New Terminal in the Current Directory
If you right click the header of the block (alternatively, click the gear icon), one of the menu items listed is **Open Terminal in New Block**. This will create a new terminal block at your current directory.

##### Open a New Terminal in a Child Directory
If you want to open a terminal for a child directory instead, you can right click on that file's row to get the **Open Terminal in New Block** option. Clicking this will open a terminal at that directory. Note that this option is only available for children that are directories.

##### Open a New Preview for a Child
To open a new Preview Block for a Child, you can right click on that file's row and select the **Open Preview in New Block** option.

#### Markdown
Opening a markdown file will bring up a view of the rendered markdown. These files cannot be edited in the preview at this time.

#### Images/Media
Opening a picture will bring up the image of that picture. Opening a video will bring up a player that lets you watch the video.
`;

export class PreviewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: NodeModel;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string | IconButtonDecl>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    preIconButton: jotai.Atom<IconButtonDecl>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    previewTextRef: React.RefObject<HTMLDivElement>;
    editMode: jotai.Atom<boolean>;
    canPreview: jotai.PrimitiveAtom<boolean>;
    specializedView: jotai.Atom<Promise<{ specializedView?: string; errorStr?: string }>>;
    loadableSpecializedView: jotai.Atom<Loadable<{ specializedView?: string; errorStr?: string }>>;
    manageConnection: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;

    metaFilePath: jotai.Atom<string>;
    statFilePath: jotai.Atom<Promise<string>>;
    normFilePath: jotai.Atom<Promise<string>>;
    loadableStatFilePath: jotai.Atom<Loadable<string>>;
    loadableFileInfo: jotai.Atom<Loadable<FileInfo>>;
    connection: jotai.Atom<string>;
    statFile: jotai.Atom<Promise<FileInfo>>;
    fullFile: jotai.Atom<Promise<FullFile>>;
    fileMimeType: jotai.Atom<Promise<string>>;
    fileMimeTypeLoadable: jotai.Atom<Loadable<string>>;
    fileContent: jotai.Atom<Promise<string>>;
    newFileContent: jotai.PrimitiveAtom<string | null>;

    openFileModal: jotai.PrimitiveAtom<boolean>;
    openFileError: jotai.PrimitiveAtom<string>;
    openFileModalGiveFocusRef: React.MutableRefObject<() => boolean>;

    markdownShowToc: jotai.PrimitiveAtom<boolean>;

    monacoRef: React.MutableRefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    showHiddenFiles: jotai.PrimitiveAtom<boolean>;
    refreshVersion: jotai.PrimitiveAtom<number>;
    refreshCallback: () => void;
    directoryKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    codeEditKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;

    setPreviewFileName(fileName: string) {
        services.ObjectService.UpdateObjectMeta(`block:${this.blockId}`, { file: fileName });
    }

    constructor(blockId: string, nodeModel: NodeModel) {
        this.viewType = "preview";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.showHiddenFiles = jotai.atom(true);
        this.refreshVersion = jotai.atom(0);
        this.previewTextRef = createRef();
        this.openFileModal = jotai.atom(false);
        this.openFileError = jotai.atom(null) as jotai.PrimitiveAtom<string>;
        this.openFileModalGiveFocusRef = createRef();
        this.manageConnection = jotai.atom(true);
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.markdownShowToc = jotai.atom(false);
        this.monacoRef = createRef();
        this.viewIcon = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const fileName = get(this.metaFilePath);
            const mimeTypeLoadable = get(this.fileMimeTypeLoadable);
            const mimeType = util.jotaiLoadableValue(mimeTypeLoadable, "");
            if (mimeType == "directory") {
                return {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    longClick: (e: React.MouseEvent<any>) => {
                        const menuItems: ContextMenuItem[] = [];
                        menuItems.push({
                            label: "Go to Home",
                            click: () => this.goHistory("~"),
                        });
                        menuItems.push({
                            label: "Go to Desktop",
                            click: () => this.goHistory("~/Desktop"),
                        });
                        menuItems.push({
                            label: "Go to Downloads",
                            click: () => this.goHistory("~/Downloads"),
                        });
                        menuItems.push({
                            label: "Go to Documents",
                            click: () => this.goHistory("~/Documents"),
                        });
                        menuItems.push({
                            label: "Go to Root",
                            click: () => this.goHistory("/"),
                        });
                        ContextMenuModel.showContextMenu(menuItems, e);
                    },
                };
            }
            return iconForFile(mimeType);
        });
        this.editMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.edit ?? false;
        });
        this.viewName = jotai.atom("Preview");
        this.viewText = jotai.atom((get) => {
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
            if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~") {
                    headerPath = `~ (${loadableFileInfo.data?.dir})`;
                }
            }

            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: headerPath,
                    ref: this.previewTextRef,
                    className: "preview-filename",
                    onClick: () => this.updateOpenFileModalAndError(true),
                },
            ];
            let saveClassName = "secondary";
            if (get(this.newFileContent) !== null) {
                saveClassName = "primary";
            }
            if (isCeView) {
                viewTextChildren.push({
                    elemtype: "textbutton",
                    text: "Save",
                    className: clsx(
                        `${saveClassName} warning border-radius-4 vertical-padding-2 horizontal-padding-10 font-size-11 font-weight-500`
                    ),
                    onClick: this.handleFileSave.bind(this),
                });
                if (get(this.canPreview)) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Preview",
                        className:
                            "secondary border-radius-4 vertical-padding-2 horizontal-padding-10 font-size-11 font-weight-500",
                        onClick: () => this.setEditMode(false),
                    });
                }
            } else if (get(this.canPreview)) {
                viewTextChildren.push({
                    elemtype: "textbutton",
                    text: "Edit",
                    className:
                        "secondary border-radius-4 vertical-padding-2 horizontal-padding-10 font-size-11 font-weight-500",
                    onClick: () => this.setEditMode(true),
                });
            }
            return [
                {
                    elemtype: "div",
                    children: viewTextChildren,
                },
            ] as HeaderElem[];
        });
        this.preIconButton = jotai.atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            if (mimeType == "directory") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.goParentDirectory.bind(this),
            };
        });
        this.endIconButtons = jotai.atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = util.jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            if (mimeType == "directory") {
                const showHiddenFiles = get(this.showHiddenFiles);
                const settings = get(atoms.settingsAtom);
                let tipIcon: IconButtonDecl[];
                if (settings["tips:show"]) {
                    tipIcon = [
                        {
                            elemtype: "iconbutton",
                            icon: "lightbulb",
                            iconColor: "var(--warning-color)",
                            className: "bulb",
                            click: () => {
                                const tips: UserInputRequest = {
                                    requestid: "",
                                    querytext: previewTipText,
                                    responsetype: "confirm",
                                    title: "Preview Tips",
                                    markdown: true,
                                    timeoutms: 0,
                                    checkboxmsg: "",
                                    publictext: true,
                                };
                                modalsModel.pushModal("TipsModal", tips);
                            },
                        },
                    ];
                } else {
                    tipIcon = [];
                }
                return [
                    ...tipIcon,
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
                ] as IconButtonDecl[];
            } else if (!isCeView && mimeType?.startsWith("text/markdown")) {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "book",
                        title: "Table of Contents",
                        click: () => this.markdownShowTocToggle(),
                    },
                ] as IconButtonDecl[];
            }
            return null;
        });
        this.metaFilePath = jotai.atom<string>((get) => {
            const file = get(this.blockAtom)?.meta?.file;
            if (util.isBlank(file)) {
                return "~";
            }
            return file;
        });
        this.statFilePath = jotai.atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.path;
        });
        this.normFilePath = jotai.atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            if (fileInfo == null) {
                return null;
            }
            if (fileInfo.isdir) {
                return fileInfo.dir + "/";
            }
            return fileInfo.dir + "/" + fileInfo.name;
        });
        this.loadableStatFilePath = loadable(this.statFilePath);
        this.connection = jotai.atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = jotai.atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.metaFilePath);
            if (fileName == null) {
                return null;
            }
            const conn = get(this.connection) ?? "";
            const statFile = await services.FileService.StatFile(conn, fileName);
            return statFile;
        });
        this.fileMimeType = jotai.atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.newFileContent = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.goParentDirectory = this.goParentDirectory.bind(this);

        const fullFileAtom = jotai.atom<Promise<FullFile>>(async (get) => {
            const fileName = get(this.metaFilePath);
            if (fileName == null) {
                return null;
            }
            const conn = get(this.connection) ?? "";
            const file = await services.FileService.ReadFile(conn, fileName);
            return file;
        });

        const fileContentAtom = jotai.atom<Promise<string>>(async (get) => {
            const fullFile = await get(fullFileAtom);
            return util.base64ToString(fullFile?.data64);
        });

        this.fullFile = fullFileAtom;
        this.fileContent = fileContentAtom;

        this.specializedView = jotai.atom<Promise<{ specializedView?: string; errorStr?: string }>>(async (get) => {
            return this.getSpecializedView(get);
        });
        this.loadableSpecializedView = loadable(this.specializedView);
        this.canPreview = jotai.atom(false);
        this.loadableFileInfo = loadable(this.statFile);
        this.connStatus = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = getConnStatusAtom(connName);
            return get(connAtom);
        });
    }

    markdownShowTocToggle() {
        globalStore.set(this.markdownShowToc, !globalStore.get(this.markdownShowToc));
    }

    async getSpecializedView(getFn: jotai.Getter): Promise<{ specializedView?: string; errorStr?: string }> {
        const mimeType = await getFn(this.fileMimeType);
        const fileInfo = await getFn(this.statFile);
        const fileName = await getFn(this.statFilePath);
        const editMode = getFn(this.editMode);

        if (fileInfo?.notfound) {
            return { errorStr: `File Not Found: ${fileInfo.path}` };
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
            return { errorStr: "File Too Large to Preiview (10 MB Max)" };
        }
        if (mimeType == "text/csv" && fileInfo.size > MaxCSVSize) {
            return { errorStr: "CSV File Too Large to Preiview (1 MB Max)" };
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
        if (mimeType.startsWith("text/markdown")) {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "markdown" };
        }
        if (isTextFile(mimeType)) {
            return { specializedView: "codeedit" };
        }
        return { errorStr: `Preview (${mimeType})` };
    }

    updateOpenFileModalAndError(isOpen, errorMsg = null) {
        globalStore.set(this.openFileModal, isOpen);
        globalStore.set(this.openFileError, errorMsg);
    }

    async goHistory(newPath: string) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = historyutil.goHistory("file", fileName, newPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);
    }

    async goParentDirectory() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const metaPath = globalStore.get(this.metaFilePath);
        const fileInfo = await globalStore.get(this.statFile);
        if (fileInfo == null) {
            return;
        }
        let newPath: string = null;
        if (!fileInfo.isdir) {
            newPath = fileInfo.dir;
        } else {
            const lastSlash = fileInfo.dir.lastIndexOf("/");
            newPath = fileInfo.dir.slice(0, lastSlash);
            if (newPath.indexOf("/") == -1) {
                return;
            }
        }
        const updateMeta = historyutil.goHistory("file", metaPath, newPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);
    }

    goHistoryBack() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = historyutil.goHistoryBack("file", curPath, blockMeta, true);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);
    }

    goHistoryForward() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = historyutil.goHistoryForward("file", curPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);
    }

    setEditMode(edit: boolean) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const blockOref = WOS.makeORef("block", this.blockId);
        services.ObjectService.UpdateObjectMeta(blockOref, { ...blockMeta, edit });
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
        const conn = globalStore.get(this.connection) ?? "";
        try {
            services.FileService.SaveFile(conn, filePath, util.stringToBase64(newFileContent));
            globalStore.set(this.newFileContent, null);
            console.log("saved file", filePath);
        } catch (error) {
            console.error("Error saving file:", error);
        }
    }

    async handleFileRevert() {
        const fileContent = await globalStore.get(this.fileContent);
        this.monacoRef.current?.setValue(fileContent);
        globalStore.set(this.newFileContent, null);
    }

    async handleOpenFile(filePath: string) {
        const fileInfo = await globalStore.get(this.statFile);
        if (fileInfo == null) {
            this.updateOpenFileModalAndError(false);
            return true;
        }
        const conn = globalStore.get(this.connection);
        try {
            const newFileInfo = await RpcApi.RemoteFileJoinCommand(WindowRpcClient, [fileInfo.dir, filePath], {
                route: makeConnRoute(conn),
            });
            this.updateOpenFileModalAndError(false);
            this.goHistory(newFileInfo.path);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", fileInfo.dir, filePath, e);
        }
    }

    isSpecializedView(sv: string): boolean {
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        return loadableSV.state == "hasData" && loadableSV.data.specializedView == sv;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: "Copy Full Path",
            click: async () => {
                const filePath = await globalStore.get(this.normFilePath);
                if (filePath == null) {
                    return;
                }
                navigator.clipboard.writeText(filePath);
            },
        });
        menuItems.push({
            label: "Copy File Name",
            click: async () => {
                const fileInfo = await globalStore.get(this.statFile);
                if (fileInfo == null || fileInfo.name == null) {
                    return;
                }
                navigator.clipboard.writeText(fileInfo.name);
            },
        });
        const mimeType = util.jotaiLoadableValue(globalStore.get(this.fileMimeTypeLoadable), "");
        if (mimeType == "directory") {
            menuItems.push({
                label: "Open Terminal in New Block",
                click: async () => {
                    const fileInfo = await globalStore.get(this.statFile);
                    const termBlockDef: BlockDef = {
                        meta: {
                            view: "term",
                            controller: "shell",
                            "cmd:cwd": fileInfo.dir,
                        },
                    };
                    await createBlock(termBlockDef);
                },
            });
        }
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        if (loadableSV.state == "hasData") {
            if (loadableSV.data.specializedView == "codeedit") {
                if (globalStore.get(this.newFileContent) != null) {
                    menuItems.push({ type: "separator" });
                    menuItems.push({
                        label: "Save File",
                        click: this.handleFileSave.bind(this),
                    });
                    menuItems.push({
                        label: "Revert File",
                        click: this.handleFileRevert.bind(this),
                    });
                }
            }
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
        if (keyutil.checkKeyPressed(e, "Cmd:ArrowLeft")) {
            this.goHistoryBack();
            return true;
        }
        if (keyutil.checkKeyPressed(e, "Cmd:ArrowRight")) {
            this.goHistoryForward();
            return true;
        }
        if (keyutil.checkKeyPressed(e, "Cmd:ArrowUp")) {
            // handle up directory
            this.goParentDirectory();
            return true;
        }
        const openModalOpen = globalStore.get(this.openFileModal);
        if (!openModalOpen) {
            if (keyutil.checkKeyPressed(e, "Cmd:o")) {
                this.updateOpenFileModalAndError(true);
                return true;
            }
        }
        const canPreview = globalStore.get(this.canPreview);
        if (canPreview) {
            if (keyutil.checkKeyPressed(e, "Cmd:e")) {
                const editMode = globalStore.get(this.editMode);
                this.setEditMode(!editMode);
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
}

function makePreviewModel(blockId: string, nodeModel: NodeModel): PreviewModel {
    const previewModel = new PreviewModel(blockId, nodeModel);
    return previewModel;
}

function MarkdownPreview({ model }: SpecializedViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const fileInfo = jotai.useAtomValue(model.statFile);
    const resolveOpts: MarkdownResolveOpts = React.useMemo<MarkdownResolveOpts>(() => {
        return {
            connName: connName,
            baseDir: fileInfo.dir,
        };
    }, [connName, fileInfo.dir]);
    return (
        <div className="view-preview view-preview-markdown">
            <Markdown textAtom={model.fileContent} showTocAtom={model.markdownShowToc} resolveOpts={resolveOpts} />
        </div>
    );
}

function StreamingPreview({ model }: SpecializedViewProps) {
    const conn = jotai.useAtomValue(model.connection);
    const fileInfo = jotai.useAtomValue(model.statFile);
    const filePath = fileInfo.path;
    const usp = new URLSearchParams();
    usp.set("path", filePath);
    if (conn != null) {
        usp.set("connection", conn);
    }
    const streamingUrl = getWebServerEndpoint() + "/wave/stream-file?" + usp.toString();
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

function CodeEditPreview({ model }: SpecializedViewProps) {
    const fileContent = jotai.useAtomValue(model.fileContent);
    const setNewFileContent = jotai.useSetAtom(model.newFileContent);
    const fileName = jotai.useAtomValue(model.statFilePath);

    function codeEditKeyDownHandler(e: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(e, "Cmd:e")) {
            model.setEditMode(false);
            return true;
        }
        if (keyutil.checkKeyPressed(e, "Cmd:s")) {
            model.handleFileSave();
            return true;
        }
        if (keyutil.checkKeyPressed(e, "Cmd:r")) {
            model.handleFileRevert();
            return true;
        }
        return false;
    }

    React.useEffect(() => {
        model.codeEditKeyDownHandler = codeEditKeyDownHandler;
        return () => {
            model.codeEditKeyDownHandler = null;
            model.monacoRef.current = null;
        };
    }, []);

    function onMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco): () => void {
        model.monacoRef.current = editor;

        editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
            const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(e.browserEvent);
            const handled = tryReinjectKey(waveEvent);
            if (handled) {
                e.stopPropagation();
                e.preventDefault();
            }
        });

        const isFocused = globalStore.get(model.nodeModel.isFocused);
        if (isFocused) {
            editor.focus();
        }

        return null;
    }

    return (
        <CodeEditor
            text={fileContent}
            filename={fileName}
            onChange={(text) => setNewFileContent(text)}
            onMount={onMount}
        />
    );
}

function CSVViewPreview({ model, parentRef }: SpecializedViewProps) {
    const fileContent = jotai.useAtomValue(model.fileContent);
    const fileName = jotai.useAtomValue(model.statFilePath);
    return <CSVView parentRef={parentRef} readonly={true} content={fileContent} filename={fileName} />;
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
    } else {
        return "file";
    }
}

function SpecializedView({ parentRef, model }: SpecializedViewProps) {
    const specializedView = jotai.useAtomValue(model.specializedView);
    const mimeType = jotai.useAtomValue(model.fileMimeType);
    const setCanPreview = jotai.useSetAtom(model.canPreview);

    React.useEffect(() => {
        setCanPreview(canPreview(mimeType));
    }, [mimeType, setCanPreview]);

    if (specializedView.errorStr != null) {
        return <CenteredDiv>{specializedView.errorStr}</CenteredDiv>;
    }
    const SpecializedViewComponent = SpecializedViewMap[specializedView.specializedView];
    if (!SpecializedViewComponent) {
        return <CenteredDiv>Invalid Specialzied View Component ({specializedView.specializedView})</CenteredDiv>;
    }
    return <SpecializedViewComponent model={model} parentRef={parentRef} />;
}

function PreviewView({
    blockId,
    blockRef,
    contentRef,
    model,
}: {
    blockId: string;
    blockRef: React.RefObject<HTMLDivElement>;
    contentRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
}) {
    const connStatus = jotai.useAtomValue(model.connStatus);
    if (connStatus?.status != "connected") {
        return null;
    }
    return (
        <>
            <OpenFileModal blockId={blockId} model={model} blockRef={blockRef} />
            <div className="full-preview scrollbar-hide-until-hover">
                <div ref={contentRef} className="full-preview-content">
                    <SpecializedView parentRef={contentRef} model={model} />
                </div>
            </div>
        </>
    );
}

const OpenFileModal = React.memo(
    ({
        model,
        blockRef,
        blockId,
    }: {
        model: PreviewModel;
        blockRef: React.RefObject<HTMLDivElement>;
        blockId: string;
    }) => {
        const openFileModal = jotai.useAtomValue(model.openFileModal);
        const curFileName = jotai.useAtomValue(model.metaFilePath);
        const [filePath, setFilePath] = useState("");
        const isNodeFocused = jotai.useAtomValue(model.nodeModel.isFocused);
        const handleKeyDown = useCallback(
            keyutil.keydownWrapper((waveEvent: WaveKeyboardEvent): boolean => {
                if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                    model.updateOpenFileModalAndError(false);
                    return true;
                }

                const handleCommandOperations = async () => {
                    if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                        model.handleOpenFile(filePath);
                        return true;
                    }
                    return false;
                };

                handleCommandOperations().catch((error) => {
                    console.error("Error handling key down:", error);
                    model.updateOpenFileModalAndError(true, "An error occurred during operation.");
                    return false;
                });
                return false;
            }),
            [model, blockId, filePath, curFileName]
        );
        const handleFileSuggestionSelect = (value) => {
            globalStore.set(model.openFileModal, false);
        };
        const handleFileSuggestionChange = (value) => {
            setFilePath(value);
        };
        const handleBackDropClick = () => {
            globalStore.set(model.openFileModal, false);
        };
        if (!openFileModal) {
            return null;
        }
        return (
            <TypeAheadModal
                label="Open path"
                blockRef={blockRef}
                anchorRef={model.previewTextRef}
                onKeyDown={handleKeyDown}
                onSelect={handleFileSuggestionSelect}
                onChange={handleFileSuggestionChange}
                onClickBackdrop={handleBackDropClick}
                autoFocus={isNodeFocused}
                giveFocusRef={model.openFileModalGiveFocusRef}
            />
        );
    }
);

export { makePreviewModel, PreviewView };
