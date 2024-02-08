// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { debounce } from "throttle-debounce";
import * as mobxReact from "mobx-react";
import {
    handleJsonFetchResponse,
    base64ToString,
    stringToBase64,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    boundInt,
    isModKeyPress,
} from "../util/util";
import { TermWrap } from "../plugins/terminal/term";
import { PluginModel } from "../plugins/plugins";
import {
    SessionDataType,
    LineType,
    RemoteType,
    HistoryItem,
    RemoteInstanceType,
    RemotePtrType,
    CmdDataType,
    FeCmdPacketType,
    TermOptsType,
    ScreenDataType,
    ScreenOptsType,
    PtyDataUpdateType,
    ModelUpdateType,
    UpdateMessage,
    InfoType,
    UIContextType,
    HistoryInfoType,
    HistoryQueryOpts,
    FeInputPacketType,
    RemoteInputPacketType,
    ContextMenuOpts,
    RendererContext,
    RendererModel,
    PtyDataType,
    BookmarkType,
    ClientDataType,
    HistoryViewDataType,
    AlertMessageType,
    HistorySearchParams,
    FocusTypeStrs,
    ScreenLinesType,
    HistoryTypeStrs,
    RendererPluginType,
    WindowSize,
    WebShareOpts,
    TermContextUnion,
    RemoteEditType,
    RemoteViewType,
    CommandRtnType,
    WebCmd,
    WebRemote,
    OpenAICmdInfoChatMessageType,
    StatusIndicatorLevel,
} from "../types/types";
import * as T from "../types/types";
import { WSControl } from "./ws";
import {
    getMonoFontSize,
    windowWidthToCols,
    windowHeightToRows,
    termWidthFromCols,
    termHeightFromRows,
} from "../util/textmeasure";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { getRendererContext, cmdStatusIsRunning } from "../app/line/lineutil";
import { MagicLayout } from "../app/magiclayout";
import { modalsRegistry } from "../app/common/modals/registry";
import * as appconst from "../app/appconst";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent, setKeyUtilPlatform } from "../util/keyutil";
import { OV, OArr, OMap, CV } from "../types/types";
import { Session } from "./session";
import { CommandRunner } from "./commandrunner";
import { ScreenLines } from "./screenlines";
import { InputModel } from "./input";
import { PluginsModel } from "./plugins";
import { Model } from "./model";

dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);

const RemotePtyRows = 8; // also in main.tsx
const RemotePtyCols = 80;
const ProdServerEndpoint = "http://127.0.0.1:1619";
const ProdServerWsEndpoint = "ws://127.0.0.1:1623";
const DevServerEndpoint = "http://127.0.0.1:8090";
const DevServerWsEndpoint = "ws://127.0.0.1:8091";
const DefaultTermFontSize = 12;
const MinFontSize = 8;
const MaxFontSize = 24;
const InputChunkSize = 500;
const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];
const TabColors = ["red", "orange", "yellow", "green", "mint", "cyan", "blue", "violet", "pink", "white"];
const TabIcons = [
    "sparkle",
    "fire",
    "ghost",
    "cloud",
    "compass",
    "crown",
    "droplet",
    "graduation-cap",
    "heart",
    "file",
];

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
const BUILD = __WAVETERM_BUILD__;

class BookmarksModel {
    globalCommandRunner: CommandRunner;
    globalModel: Model;
    bookmarks: OArr<BookmarkType> = mobx.observable.array([], {
        name: "Bookmarks",
    });
    activeBookmark: OV<string> = mobx.observable.box(null, {
        name: "activeBookmark",
    });
    editingBookmark: OV<string> = mobx.observable.box(null, {
        name: "editingBookmark",
    });
    pendingDelete: OV<string> = mobx.observable.box(null, {
        name: "pendingDelete",
    });
    copiedIndicator: OV<string> = mobx.observable.box(null, {
        name: "copiedIndicator",
    });

    tempDesc: OV<string> = mobx.observable.box("", {
        name: "bookmarkEdit-tempDesc",
    });
    tempCmd: OV<string> = mobx.observable.box("", {
        name: "bookmarkEdit-tempCmd",
    });

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        this.globalCommandRunner = CommandRunner.getInstance();
    }

    showBookmarksView(bmArr: BookmarkType[], selectedBookmarkId: string): void {
        bmArr = bmArr ?? [];
        mobx.action(() => {
            this.reset();
            this.globalModel.activeMainView.set("bookmarks");
            this.bookmarks.replace(bmArr);
            if (selectedBookmarkId != null) {
                this.selectBookmark(selectedBookmarkId);
            }
            if (this.activeBookmark.get() == null && bmArr.length > 0) {
                this.activeBookmark.set(bmArr[0].bookmarkid);
            }
        })();
    }

    reset(): void {
        mobx.action(() => {
            this.activeBookmark.set(null);
            this.editingBookmark.set(null);
            this.pendingDelete.set(null);
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
    }

    closeView(): void {
        this.globalModel.showSessionView();
        setTimeout(() => this.globalModel.inputModel.giveFocus(), 50);
    }

    @boundMethod
    clearPendingDelete(): void {
        mobx.action(() => this.pendingDelete.set(null))();
    }

    useBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        mobx.action(() => {
            this.reset();
            this.globalModel.showSessionView();
            this.globalModel.inputModel.setCurLine(bm.cmdstr);
            setTimeout(() => this.globalModel.inputModel.giveFocus(), 50);
        })();
    }

    selectBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        if (this.activeBookmark.get() == bookmarkId) {
            return;
        }
        mobx.action(() => {
            this.cancelEdit();
            this.activeBookmark.set(bookmarkId);
        })();
    }

    cancelEdit(): void {
        mobx.action(() => {
            this.pendingDelete.set(null);
            this.editingBookmark.set(null);
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
    }

    confirmEdit(): void {
        if (this.editingBookmark.get() == null) {
            return;
        }
        let bm = this.getBookmark(this.editingBookmark.get());
        mobx.action(() => {
            this.editingBookmark.set(null);
            bm.description = this.tempDesc.get();
            bm.cmdstr = this.tempCmd.get();
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
        this.globalCommandRunner.editBookmark(bm.bookmarkid, bm.description, bm.cmdstr);
    }

    handleDeleteBookmark(bookmarkId: string): void {
        if (this.pendingDelete.get() == null || this.pendingDelete.get() != this.activeBookmark.get()) {
            mobx.action(() => this.pendingDelete.set(this.activeBookmark.get()))();
            setTimeout(this.clearPendingDelete, 2000);
            return;
        }
        this.globalCommandRunner.deleteBookmark(bookmarkId);
        this.clearPendingDelete();
    }

    getBookmark(bookmarkId: string): BookmarkType {
        if (bookmarkId == null) {
            return null;
        }
        for (const bm of this.bookmarks) {
            if (bm.bookmarkid == bookmarkId) {
                return bm;
            }
        }
        return null;
    }

    getBookmarkPos(bookmarkId: string): number {
        if (bookmarkId == null) {
            return -1;
        }
        for (let i = 0; i < this.bookmarks.length; i++) {
            let bm = this.bookmarks[i];
            if (bm.bookmarkid == bookmarkId) {
                return i;
            }
        }
        return -1;
    }

    getActiveBookmark(): BookmarkType {
        let activeBookmarkId = this.activeBookmark.get();
        return this.getBookmark(activeBookmarkId);
    }

    handleEditBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        mobx.action(() => {
            this.pendingDelete.set(null);
            this.activeBookmark.set(bookmarkId);
            this.editingBookmark.set(bookmarkId);
            this.tempDesc.set(bm.description ?? "");
            this.tempCmd.set(bm.cmdstr ?? "");
        })();
    }

    handleCopyBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        navigator.clipboard.writeText(bm.cmdstr);
        mobx.action(() => {
            this.copiedIndicator.set(bm.bookmarkid);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.copiedIndicator.set(null);
            })();
        }, 600);
    }

    mergeBookmarks(bmArr: BookmarkType[]): void {
        mobx.action(() => {
            genMergeSimpleData(
                this.bookmarks,
                bmArr,
                (bm: BookmarkType) => bm.bookmarkid,
                (bm: BookmarkType) => sprintf("%05d", bm.orderidx)
            );
        })();
    }

    handleDocKeyDown(e: any): void {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Escape")) {
            e.preventDefault();
            if (this.editingBookmark.get() != null) {
                this.cancelEdit();
                return;
            }
            this.closeView();
            return;
        }
        if (this.editingBookmark.get() != null) {
            return;
        }
        if (checkKeyPressed(waveEvent, "Backspace") || checkKeyPressed(waveEvent, "Delete")) {
            if (this.activeBookmark.get() == null) {
                return;
            }
            e.preventDefault();
            this.handleDeleteBookmark(this.activeBookmark.get());
            return;
        }

        if (
            checkKeyPressed(waveEvent, "ArrowUp") ||
            checkKeyPressed(waveEvent, "ArrowDown") ||
            checkKeyPressed(waveEvent, "PageUp") ||
            checkKeyPressed(waveEvent, "PageDown")
        ) {
            e.preventDefault();
            if (this.bookmarks.length == 0) {
                return;
            }
            let newPos = 0; // if active is null, then newPos will be 0 (select the first)
            if (this.activeBookmark.get() != null) {
                let amtMap = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
                let amt = amtMap[e.code];
                let curIdx = this.getBookmarkPos(this.activeBookmark.get());
                newPos = curIdx + amt;
                if (newPos < 0) {
                    newPos = 0;
                }
                if (newPos >= this.bookmarks.length) {
                    newPos = this.bookmarks.length - 1;
                }
            }
            let bm = this.bookmarks[newPos];
            mobx.action(() => {
                this.activeBookmark.set(bm.bookmarkid);
            })();
            return;
        }
        if (checkKeyPressed(waveEvent, "Enter")) {
            if (this.activeBookmark.get() == null) {
                return;
            }
            this.useBookmark(this.activeBookmark.get());
            return;
        }
        if (checkKeyPressed(waveEvent, "e")) {
            if (this.activeBookmark.get() == null) {
                return;
            }
            e.preventDefault();
            this.handleEditBookmark(this.activeBookmark.get());
            return;
        }
        if (checkKeyPressed(waveEvent, "c")) {
            if (this.activeBookmark.get() == null) {
                return;
            }
            e.preventDefault();
            this.handleCopyBookmark(this.activeBookmark.get());
        }
    }
}

export { BookmarksModel };
