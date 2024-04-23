// Copyright 2023-2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { boundMethod } from "autobind-decorator";
import * as mobx from "mobx";

import { InlineSettingsTextEdit } from "./inlinesettingstextedit";

export class InlineSettingsNumberEdit extends InlineSettingsTextEdit {
    @boundMethod
    handleChangeText(e: any): void {
        let value = e.target.value;
        if (value === "" || /^\d*$/.test(value)) {
            mobx.action(() => {
                this.tempText.set(value);
            })();
        }
    }

    render() {
        // Use the render method from InlineSettingsTextEdit
        const renderedTextEdit = super.render();
        return React.cloneElement(renderedTextEdit);
    }
}
