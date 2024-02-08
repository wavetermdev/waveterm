// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { isBlank } from "../util/util";
import {
    LineType,
    HistoryItem,
    CmdDataType,
    HistoryViewDataType,
    HistorySearchParams,
    CommandRtnType,
} from "../types/types";
import { termWidthFromCols, termHeightFromRows } from "../util/textmeasure";
import dayjs from "dayjs";
import * as appconst from "../app/appconst";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "../util/keyutil";
import { OV, OArr, OMap } from "../types/types";
import { CommandRunner } from "./commandrunner";
import { Model } from "./model";
import { Cmd } from "./cmd";
import { SpecialLineContainer } from "./speciallinecontainer";

const HistoryPageSize = 50;

class HistoryViewModel {
    globalCommandRunner: CommandRunner;
    globalModel: Model;
    items: OArr<HistoryItem> = mobx.observable.array([], {
        name: "HistoryItems",
    });
    hasMore: OV<boolean> = mobx.observable.box(false, {
        name: "historyview-hasmore",
    });
    offset: OV<number> = mobx.observable.box(0, { name: "historyview-offset" });
    searchText: OV<string> = mobx.observable.box("", {
        name: "historyview-searchtext",
    });
    activeSearchText: string = null;
    selectedItems: OMap<string, boolean> = mobx.observable.map({}, { name: "historyview-selectedItems" });
    deleteActive: OV<boolean> = mobx.observable.box(false, {
        name: "historyview-deleteActive",
    });
    activeItem: OV<string> = mobx.observable.box(null, {
        name: "historyview-activeItem",
    });
    searchSessionId: OV<string> = mobx.observable.box(null, {
        name: "historyview-searchSessionId",
    });
    searchRemoteId: OV<string> = mobx.observable.box(null, {
        name: "historyview-searchRemoteId",
    });
    searchShowMeta: OV<boolean> = mobx.observable.box(true, {
        name: "historyview-searchShowMeta",
    });
    searchFromDate: OV<string> = mobx.observable.box(null, {
        name: "historyview-searchfromts",
    });
    searchFilterCmds: OV<boolean> = mobx.observable.box(true, {
        name: "historyview-filtercmds",
    });
    nextRawOffset: number = 0;
    curRawOffset: number = 0;

    historyItemLines: LineType[] = [];
    historyItemCmds: CmdDataType[] = [];

    specialLineContainer: SpecialLineContainer;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        this.globalCommandRunner = CommandRunner.getInstance();
    }

    closeView(): void {
        this.globalModel.showSessionView();
        setTimeout(() => this.globalModel.inputModel.giveFocus(), 50);
    }

    getLineById(lineId: string): LineType {
        if (isBlank(lineId)) {
            return null;
        }
        for (const line of this.historyItemLines) {
            if (line.lineid == lineId) {
                return line;
            }
        }
        return null;
    }

    getCmdById(lineId: string): Cmd {
        if (isBlank(lineId)) {
            return null;
        }
        for (const cmd of this.historyItemCmds) {
            if (cmd.lineid == lineId) {
                return new Cmd(cmd);
            }
        }
        return null;
    }

    getHistoryItemById(historyId: string): HistoryItem {
        if (isBlank(historyId)) {
            return null;
        }
        for (const hitem of this.items) {
            if (hitem.historyid == historyId) {
                return hitem;
            }
        }
        return null;
    }

    setActiveItem(historyId: string) {
        if (this.activeItem.get() == historyId) {
            return;
        }
        let hitem = this.getHistoryItemById(historyId);
        mobx.action(() => {
            if (hitem == null) {
                this.activeItem.set(null);
                this.specialLineContainer = null;
            } else {
                this.activeItem.set(hitem.historyid);
                let width = termWidthFromCols(80, this.globalModel.termFontSize.get());
                let height = termHeightFromRows(25, this.globalModel.termFontSize.get());
                this.specialLineContainer = new SpecialLineContainer(
                    this,
                    { width, height },
                    false,
                    appconst.LineContainer_History
                );
            }
        })();
    }

    doSelectedDelete(): void {
        if (!this.deleteActive.get()) {
            mobx.action(() => {
                this.deleteActive.set(true);
            })();
            setTimeout(this.clearActiveDelete, 2000);
            return;
        }
        let prtn = this.globalModel.showAlert({
            message: "Deleting lines from history also deletes their content from your workspaces.",
            confirm: true,
        });
        prtn.then((result) => {
            if (!result) {
                return;
            }
            if (result) {
                this._deleteSelected();
            }
        });
    }

    _deleteSelected(): void {
        let lineIds = Array.from(this.selectedItems.keys());
        let prtn = this.globalCommandRunner.historyPurgeLines(lineIds);
        prtn.then((result: CommandRtnType) => {
            if (!result.success) {
                this.globalModel.showAlert({ message: "Error removing history lines." });
            }
        });
        let params = this._getSearchParams();
        this.globalCommandRunner.historyView(params);
    }

    @boundMethod
    clearActiveDelete(): void {
        mobx.action(() => {
            this.deleteActive.set(false);
        })();
    }

    _getSearchParams(newOffset?: number, newRawOffset?: number): HistorySearchParams {
        let offset = newOffset ?? this.offset.get();
        let rawOffset = newRawOffset ?? this.curRawOffset;
        let opts: HistorySearchParams = {
            offset: offset,
            rawOffset: rawOffset,
            searchText: this.activeSearchText,
            searchSessionId: this.searchSessionId.get(),
            searchRemoteId: this.searchRemoteId.get(),
        };
        if (!this.searchShowMeta.get()) {
            opts.noMeta = true;
        }
        if (this.searchFromDate.get() != null) {
            let fromDate = this.searchFromDate.get();
            let fromTs = dayjs(fromDate, "YYYY-MM-DD").valueOf();
            let d = new Date(fromTs);
            d.setDate(d.getDate() + 1);
            let ts = d.getTime() - 1;
            opts.fromTs = ts;
        }
        if (this.searchFilterCmds.get()) {
            opts.filterCmds = true;
        }
        return opts;
    }

    reSearch(): void {
        this.setActiveItem(null);
        this.globalCommandRunner.historyView(this._getSearchParams());
    }

    resetAllFilters(): void {
        mobx.action(() => {
            this.activeSearchText = "";
            this.searchText.set("");
            this.searchSessionId.set(null);
            this.searchRemoteId.set(null);
            this.searchFromDate.set(null);
            this.searchShowMeta.set(true);
            this.searchFilterCmds.set(true);
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setFromDate(fromDate: string): void {
        if (this.searchFromDate.get() == fromDate) {
            return;
        }
        mobx.action(() => {
            this.searchFromDate.set(fromDate);
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchFilterCmds(filter: boolean): void {
        if (this.searchFilterCmds.get() == filter) {
            return;
        }
        mobx.action(() => {
            this.searchFilterCmds.set(filter);
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchShowMeta(show: boolean): void {
        if (this.searchShowMeta.get() == show) {
            return;
        }
        mobx.action(() => {
            this.searchShowMeta.set(show);
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchSessionId(sessionId: string): void {
        if (this.searchSessionId.get() == sessionId) {
            return;
        }
        mobx.action(() => {
            this.searchSessionId.set(sessionId);
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchRemoteId(remoteId: string): void {
        if (this.searchRemoteId.get() == remoteId) {
            return;
        }
        mobx.action(() => {
            this.searchRemoteId.set(remoteId);
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    goPrev(): void {
        let offset = this.offset.get();
        offset = offset - HistoryPageSize;
        if (offset < 0) {
            offset = 0;
        }
        let params = this._getSearchParams(offset, 0);
        this.globalCommandRunner.historyView(params);
    }

    goNext(): void {
        let offset = this.offset.get();
        offset += HistoryPageSize;
        let params = this._getSearchParams(offset, this.nextRawOffset ?? 0);
        this.globalCommandRunner.historyView(params);
    }

    submitSearch(): void {
        mobx.action(() => {
            this.hasMore.set(false);
            this.items.replace([]);
            this.activeSearchText = this.searchText.get();
            this.historyItemLines = [];
            this.historyItemCmds = [];
        })();
        this.globalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    handleDocKeyDown(e: any): void {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Escape")) {
            e.preventDefault();
            this.closeView();
            return;
        }
    }

    showHistoryView(data: HistoryViewDataType): void {
        mobx.action(() => {
            this.globalModel.activeMainView.set("history");
            this.hasMore.set(data.hasmore);
            this.items.replace(data.items || []);
            this.offset.set(data.offset);
            this.nextRawOffset = data.nextrawoffset;
            this.curRawOffset = data.rawoffset;
            this.historyItemLines = data.lines ?? [];
            this.historyItemCmds = data.cmds ?? [];
            this.selectedItems.clear();
        })();
    }
}

export { HistoryViewModel };
