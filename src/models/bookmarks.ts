// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { genMergeSimpleData } from "@/util/util";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import { GlobalCommandRunner } from "./global";
import { Model } from "./model";

class BookmarksModel {
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
        GlobalCommandRunner.editBookmark(bm.bookmarkid, bm.description, bm.cmdstr);
    }

    handleDeleteBookmark(bookmarkId: string): void {
        if (this.pendingDelete.get() == null || this.pendingDelete.get() != this.activeBookmark.get()) {
            mobx.action(() => this.pendingDelete.set(this.activeBookmark.get()))();
            setTimeout(this.clearPendingDelete, 2000);
            return;
        }
        GlobalCommandRunner.deleteBookmark(bookmarkId);
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
