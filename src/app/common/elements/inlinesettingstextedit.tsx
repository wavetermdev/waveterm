// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { If } from "tsx-control-statements/components";
import { adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import { GlobalModel } from "../../../models/global";

import "./inlinesettingstextedit.less";

@mobxReact.observer
class InlineSettingsTextEdit extends React.Component<
    {
        text: string;
        value: string;
        onChange: (val: string) => void;
        maxLength: number;
        placeholder: string;
        showIcon?: boolean;
    },
    {}
> {
    isEditing: OV<boolean> = mobx.observable.box(false, { name: "inlineedit-isEditing" });
    tempText: OV<string>;
    shouldFocus: boolean = false;
    inputRef: React.RefObject<any> = React.createRef();

    componentDidMount(): void {
        let keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("pane", "inlineedit", "generic:confirm", (waveEvent) => {
            this.confirmChange();
            return true;
        });
        keybindManager.registerKeybinding("pane", "inlineedit", "generic:cancel", (waveEvent) => {
            this.cancelChange();
            return true;
        });
    }

    componentWillUnmount(): void {
        let keybindManager = GlobalModel.keybindManager;
        keybindManager.unregisterDomain("inlineedit");
    }

    componentDidUpdate(): void {
        if (this.shouldFocus) {
            this.shouldFocus = false;
            if (this.inputRef.current != null) {
                this.inputRef.current.focus();
            }
        }
    }

    @boundMethod
    handleChangeText(e: any): void {
        mobx.action(() => {
            this.tempText.set(e.target.value);
        })();
    }

    @boundMethod
    confirmChange(): void {
        mobx.action(() => {
            let newText = this.tempText.get();
            this.isEditing.set(false);
            this.tempText = null;
            this.props.onChange(newText);
        })();
    }

    @boundMethod
    cancelChange(): void {
        mobx.action(() => {
            this.isEditing.set(false);
            this.tempText = null;
        })();
    }

    @boundMethod
    clickEdit(): void {
        mobx.action(() => {
            this.isEditing.set(true);
            this.shouldFocus = true;
            this.tempText = mobx.observable.box(this.props.value, { name: "inlineedit-tempText" });
        })();
    }

    render() {
        if (this.isEditing.get()) {
            return (
                <div className={cn("settings-input inline-edit", "edit-active")}>
                    <div className="field has-addons">
                        <div className="control">
                            <input
                                ref={this.inputRef}
                                className="input"
                                type="text"
                                onKeyDown={this.handleKeyDown}
                                placeholder={this.props.placeholder}
                                onChange={this.handleChangeText}
                                value={this.tempText.get()}
                                maxLength={this.props.maxLength}
                            />
                        </div>
                        <div className="control">
                            <div
                                onClick={this.cancelChange}
                                title="Cancel (Esc)"
                                className="button is-prompt-danger is-outlined is-small"
                            >
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-solid fa-xmark" />
                                </span>
                            </div>
                        </div>
                        <div className="control">
                            <div
                                onClick={this.confirmChange}
                                title="Confirm (Enter)"
                                className="button is-wave-green is-outlined is-small"
                            >
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-solid fa-check" />
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        } else {
            return (
                <div onClick={this.clickEdit} className={cn("settings-input inline-edit", "edit-not-active")}>
                    {this.props.text}
                    <If condition={this.props.showIcon}>
                        <i className="fa-sharp fa-solid fa-pen" />
                    </If>
                </div>
            );
        }
    }
}

export { InlineSettingsTextEdit };
