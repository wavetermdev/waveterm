// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, RemotesModel } from "../../models";
import { Toggle, InlineSettingsTextEdit, SettingsError, Dropdown } from "../common/elements";
import * as types from "../../types/types";
import { commandRtnHandler, isBlank } from "../../util/util";
import * as appconst from "../appconst";

import "./clientsettings.less";

type DDItem = {
    label: string;
    value: string;
};

@mobxReact.observer
class ClientSettingsView extends React.Component<{ model: RemotesModel }, { hoveredItemId: string }> {
    fontSizeDropdownActive: types.OV<boolean> = mobx.observable.box(false, {
        name: "clientSettings-fontSizeDropdownActive",
    });
    errorMessage: types.OV<string> = mobx.observable.box(null, { name: "ClientSettings-errorMessage" });

    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.errorMessage.set(null);
        })();
    }

    @boundMethod
    handleChangeFontSize(fontSize: string): void {
        let newFontSize = Number(fontSize);
        this.fontSizeDropdownActive.set(false);
        if (GlobalModel.termFontSize.get() == newFontSize) {
            return;
        }
        let prtn = GlobalCommandRunner.setTermFontSize(newFontSize, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    togglefontSizeDropdown(): void {
        mobx.action(() => {
            this.fontSizeDropdownActive.set(!this.fontSizeDropdownActive.get());
        })();
    }

    @boundMethod
    handleChangeTelemetry(val: boolean): void {
        let prtn: Promise<types.CommandRtnType> = null;
        if (val) {
            prtn = GlobalCommandRunner.telemetryOn(false);
        } else {
            prtn = GlobalCommandRunner.telemetryOff(false);
        }
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeReleaseCheck(val: boolean): void {
        let prtn: Promise<types.CommandRtnType> = null;
        if (val) {
            prtn = GlobalCommandRunner.releaseCheckAutoOn(false);
        } else {
            prtn = GlobalCommandRunner.releaseCheckAutoOff(false);
        }
        commandRtnHandler(prtn, this.errorMessage);
    }

    getFontSizes(): DDItem[] {
        let availableFontSizes: DDItem[] = [];
        for (let s = appconst.MinFontSize; s <= appconst.MaxFontSize; s++) {
            availableFontSizes.push({ label: s + "px", value: String(s) });
        }
        return availableFontSizes;
    }

    @boundMethod
    inlineUpdateOpenAIModel(newModel: string): void {
        let prtn = GlobalCommandRunner.setClientOpenAISettings({ model: newModel });
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    inlineUpdateOpenAIToken(newToken: string): void {
        let prtn = GlobalCommandRunner.setClientOpenAISettings({ apitoken: newToken });
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    inlineUpdateOpenAIMaxTokens(newMaxTokensStr: string): void {
        let prtn = GlobalCommandRunner.setClientOpenAISettings({ maxtokens: newMaxTokensStr });
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    setErrorMessage(msg: string): void {
        mobx.action(() => {
            this.errorMessage.set(msg);
        })();
    }

    @boundMethod
    handleClose(): void {
        GlobalModel.clientSettingsViewModel.closeView();
    }

    @boundMethod
    handleChangeShortcut(newShortcut: string): void {
        let prtn = GlobalCommandRunner.setGlobalShortcut(newShortcut);
        commandRtnHandler(prtn, this.errorMessage);
    }

    getFKeys(): DDItem[] {
        let opts: DDItem[] = [];
        opts.push({ label: "Disabled", value: "" });
        let platform = GlobalModel.getPlatform();
        for (let i = 1; i <= 12; i++) {
            let shortcut = (platform == "darwin" ? "Cmd" : "Alt") + "+F" + String(i);
            opts.push({ label: shortcut, value: shortcut });
        }
        return opts;
    }

    getCurrentShortcut(): string {
        let clientData = GlobalModel.clientData.get();
        return clientData?.clientopts?.globalshortcut ?? "";
    }

    render() {
        let isHidden = GlobalModel.activeMainView.get() != "clientsettings";
        if (isHidden) {
            return null;
        }

        let cdata: types.ClientDataType = GlobalModel.clientData.get();
        let openAIOpts = cdata.openaiopts ?? {};
        let apiTokenStr = isBlank(openAIOpts.apitoken) ? "(not set)" : "********";
        let maxTokensStr = String(
            openAIOpts.maxtokens == null || openAIOpts.maxtokens == 0 ? 1000 : openAIOpts.maxtokens
        );
        let curFontSize = GlobalModel.termFontSize.get();

        return (
            <div className={cn("view clientsettings-view")}>
                <header className="header">
                    <div className="clientsettings-title text-primary">Client Settings</div>
                    <div className="close-div hoverEffect" title="Close (Escape)" onClick={this.handleClose}>
                        <i className="fa-sharp fa-solid fa-xmark"></i>
                    </div>
                </header>
                <div className="content">
                    <div className="settings-field">
                        <div className="settings-label">Term Font Size</div>
                        <div className="settings-input">
                            <Dropdown
                                className="font-size-dropdown"
                                options={this.getFontSizes()}
                                defaultValue={`${curFontSize}px`}
                                onChange={this.handleChangeFontSize}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Client ID</div>
                        <div className="settings-input">{cdata.clientid}</div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Client Version</div>
                        <div className="settings-input">
                            {appconst.VERSION} {appconst.BUILD}
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">DB Version</div>
                        <div className="settings-input">{cdata.dbversion}</div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Basic Telemetry</div>
                        <div className="settings-input">
                            <Toggle checked={!cdata.clientopts.notelemetry} onChange={this.handleChangeTelemetry} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Check for Updates</div>
                        <div className="settings-input">
                            <Toggle
                                checked={!cdata.clientopts.noreleasecheck}
                                onChange={this.handleChangeReleaseCheck}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">OpenAI Token</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder=""
                                text={apiTokenStr}
                                value={""}
                                onChange={this.inlineUpdateOpenAIToken}
                                maxLength={100}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">OpenAI Model</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder="gpt-3.5-turbo"
                                text={isBlank(openAIOpts.model) ? "gpt-3.5-turbo" : openAIOpts.model}
                                value={openAIOpts.model ?? ""}
                                onChange={this.inlineUpdateOpenAIModel}
                                maxLength={100}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">OpenAI MaxTokens</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder=""
                                text={maxTokensStr}
                                value={maxTokensStr}
                                onChange={this.inlineUpdateOpenAIMaxTokens}
                                maxLength={10}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Global Hotkey</div>
                        <div className="settings-input">
                            <Dropdown
                                className="hotkey-dropdown"
                                options={this.getFKeys()}
                                defaultValue={this.getCurrentShortcut()}
                                onChange={this.handleChangeShortcut}
                            />
                        </div>
                    </div>
                    <SettingsError errorMessage={this.errorMessage} />
                </div>
            </div>
        );
    }
}

export { ClientSettingsView };
