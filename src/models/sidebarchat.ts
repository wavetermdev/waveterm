// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { Model } from "./model";

class SidebarChatModel {
    globalModel: Model;
    sidebarChatFocus: {
        input: OV<boolean>;
        block: OV<boolean>;
    };

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        mobx.makeObservable(this);
        this.sidebarChatFocus = {
            input: mobx.observable.box(false, { name: "inputFocus" }),
            block: mobx.observable.box(false, { name: "blockFocus" }),
        };
    }

    @mobx.action
    setFocus(section: "input" | "block", focus: boolean): void {
        document.querySelector(".sidebarchat .sidebarchat-input");
        this.sidebarChatFocus[section].set(focus);
    }

    getFocus(section?: "input" | "block"): boolean {
        if (section == null) {
            return this.sidebarChatFocus.input.get() || this.sidebarChatFocus.block.get();
        }
        return this.sidebarChatFocus[section].get();
    }

    @mobx.action
    resetFocus(): void {
        this.sidebarChatFocus.input.set(false);
        this.sidebarChatFocus.block.set(false);
    }
}

export { SidebarChatModel };
