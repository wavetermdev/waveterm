// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { Model } from "./model";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";

class ClientSettingsViewModel {
    globalModel: Model;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    closeView(): void {
        this.globalModel.showSessionView();
        setTimeout(() => this.globalModel.inputModel.giveFocus(), 50);
    }

    showClientSettingsView(): void {
        mobx.action(() => {
            this.globalModel.activeMainView.set("clientsettings");
        })();
    }
}

export { ClientSettingsViewModel };
