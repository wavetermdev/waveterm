// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { Model } from "./model";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";

class ConnectionsViewModel {
    globalModel: Model;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    closeView(): void {
        this.globalModel.showSessionView();
        setTimeout(() => this.globalModel.inputModel.giveFocus(), 50);
    }

    showConnectionsView(): void {
        mobx.action(() => {
            this.globalModel.activeMainView.set("connections");
        })();
    }

    handleDocKeyDown(e: any): void {
        const waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Escape")) {
            e.preventDefault();
            this.closeView();
            return;
        }
    }
}

export { ConnectionsViewModel };
