// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { stringToBase64 } from "@/util/util";
import { TermWrap } from "@/plugins/terminal/term";
import * as appconst from "@/app/appconst";
import { GlobalCommandRunner } from "./global";
import { Model } from "./model";
import { getTermPtyData } from "@/util/modelutil";

class RemotesModel {
    globalModel: Model;
    selectedRemoteId: OV<string> = mobx.observable.box(null, {
        name: "RemotesModel-selectedRemoteId",
    });
    remoteTermWrap: TermWrap = null;
    remoteTermWrapFocus: OV<boolean> = mobx.observable.box(false, {
        name: "RemotesModel-remoteTermWrapFocus",
    });
    showNoInputMsg: OV<boolean> = mobx.observable.box(false, {
        name: "RemotesModel-showNoInputMg",
    });
    showNoInputTimeoutId: any = null;
    remoteEdit: OV<RemoteEditType> = mobx.observable.box(null, {
        name: "RemotesModel-remoteEdit",
    });
    recentConnAddedState: OV<boolean> = mobx.observable.box(false, {
        name: "RemotesModel-recentlyAdded",
    });

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    get recentConnAdded(): boolean {
        return this.recentConnAddedState.get();
    }

    @boundMethod
    setRecentConnAdded(value: boolean) {
        mobx.action(() => {
            this.recentConnAddedState.set(value);
        })();
    }

    deSelectRemote(): void {
        mobx.action(() => {
            this.selectedRemoteId.set(null);
            this.remoteEdit.set(null);
        })();
    }

    openReadModal(remoteId: string): void {
        mobx.action(() => {
            this.setRecentConnAdded(false);
            this.selectedRemoteId.set(remoteId);
            this.remoteEdit.set(null);
            this.globalModel.modalsModel.pushModal(appconst.VIEW_REMOTE);
        })();
    }

    openAddModal(redit: RemoteEditType): void {
        mobx.action(() => {
            this.remoteEdit.set(redit);
            this.globalModel.modalsModel.pushModal(appconst.CREATE_REMOTE);
        })();
    }

    openEditModal(redit?: RemoteEditType): void {
        mobx.action(() => {
            this.selectedRemoteId.set(redit?.remoteid);
            this.remoteEdit.set(redit);
            this.globalModel.modalsModel.pushModal(appconst.EDIT_REMOTE);
        })();
    }

    selectRemote(remoteId: string): void {
        if (this.selectedRemoteId.get() == remoteId) {
            return;
        }
        mobx.action(() => {
            this.selectedRemoteId.set(remoteId);
            this.remoteEdit.set(null);
        })();
    }

    @boundMethod
    startEditAuth(): void {
        let remoteId = this.selectedRemoteId.get();
        if (remoteId != null) {
            GlobalCommandRunner.openEditRemote(remoteId);
        }
    }

    isAuthEditMode(): boolean {
        return this.remoteEdit.get() != null;
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            this.globalModel.modalsModel.popModal();
        })();
        setTimeout(() => this.globalModel.refocus(), 10);
    }

    disposeTerm(): void {
        if (this.remoteTermWrap == null) {
            return;
        }
        this.remoteTermWrap.dispose();
        this.remoteTermWrap = null;
        mobx.action(() => {
            this.remoteTermWrapFocus.set(false);
        })();
    }

    receiveData(remoteId: string, ptyPos: number, ptyData: Uint8Array, reason?: string) {
        if (this.remoteTermWrap == null) {
            return;
        }
        if (this.remoteTermWrap.getContextRemoteId() != remoteId) {
            return;
        }
        this.remoteTermWrap.receiveData(ptyPos, ptyData);
    }

    @boundMethod
    setRemoteTermWrapFocus(focus: boolean): void {
        mobx.action(() => {
            this.remoteTermWrapFocus.set(focus);
        })();
    }

    @boundMethod
    setShowNoInputMsg(val: boolean) {
        mobx.action(() => {
            if (this.showNoInputTimeoutId != null) {
                clearTimeout(this.showNoInputTimeoutId);
                this.showNoInputTimeoutId = null;
            }
            if (val) {
                this.showNoInputMsg.set(true);
                this.showNoInputTimeoutId = setTimeout(() => this.setShowNoInputMsg(false), 2000);
            } else {
                this.showNoInputMsg.set(false);
            }
        })();
    }

    @boundMethod
    termKeyHandler(remoteId: string, event: any, termWrap: TermWrap): void {
        let remote = this.globalModel.getRemote(remoteId);
        if (remote == null) {
            return;
        }
        if (remote.status != "connecting" && remote.installstatus != "connecting") {
            this.setShowNoInputMsg(true);
            return;
        }
        let inputPacket: RemoteInputPacketType = {
            type: "remoteinput",
            remoteid: remoteId,
            inputdata64: stringToBase64(event.key),
        };
        this.globalModel.sendInputPacket(inputPacket);
    }

    createTermWrap(elem: HTMLElement): void {
        this.disposeTerm();
        let remoteId = this.selectedRemoteId.get();
        if (remoteId == null) {
            return;
        }
        let termOpts = {
            rows: appconst.RemotePtyRows,
            cols: appconst.RemotePtyCols,
            flexrows: false,
            maxptysize: 64 * 1024,
        };
        let termWrap = new TermWrap(elem, {
            termContext: { remoteId: remoteId },
            usedRows: appconst.RemotePtyRows,
            termOpts: termOpts,
            winSize: null,
            keyHandler: (e, termWrap) => {
                this.termKeyHandler(remoteId, e, termWrap);
            },
            focusHandler: this.setRemoteTermWrapFocus.bind(this),
            isRunning: true,
            fontSize: this.globalModel.getTermFontSize(),
            fontFamily: this.globalModel.getTermFontFamily(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: null,
        });
        this.remoteTermWrap = termWrap;
    }
}

export { RemotesModel };
