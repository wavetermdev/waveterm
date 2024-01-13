// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, MinFontSize, MaxFontSize, RemotesModel } from "../../model/model";
import { Toggle, InlineSettingsTextEdit, SettingsError, Dropdown } from "../common/common";
import { CommandRtnType, ClientDataType } from "../../types/types";
import { commandRtnHandler, isBlank } from "../../util/util";

import "./clientsettings.less";

type OV<V> = mobx.IObservableValue<V>;

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
const BUILD = __WAVETERM_BUILD__;

@mobxReact.observer
class ClientSettingsView extends React.Component<{ model: RemotesModel }, { hoveredItemId: string }> {
    fontSizeDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "clientSettings-fontSizeDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ClientSettings-errorMessage" });

    @boundMethod
    closeModal(): void {
        GlobalModel.modalsModel.popModal();
    }

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
        let prtn: Promise<CommandRtnType> = null;
        if (val) {
            prtn = GlobalCommandRunner.telemetryOn(false);
        } else {
            prtn = GlobalCommandRunner.telemetryOff(false);
        }
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeReleaseCheck(val: boolean): void {
        let prtn: Promise<CommandRtnType> = null;
        if (val) {
            prtn = GlobalCommandRunner.releaseCheckAutoOn(false);
        } else {
            prtn = GlobalCommandRunner.releaseCheckAutoOff(false);
        }
        commandRtnHandler(prtn, this.errorMessage);
    }

    getFontSizes(): any {
        let availableFontSizes: { label: string; value: number }[] = [];
        for (let s = MinFontSize; s <= MaxFontSize; s++) {
            availableFontSizes.push({ label: s + "px", value: s });
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

    render() {
        let isHidden = GlobalModel.activeMainView.get() != "clientsettings";
        if (isHidden) {
            return null;
        }

        let cdata: ClientDataType = GlobalModel.clientData.get();
        let openAIOpts = cdata.openaiopts ?? {};
        let apiTokenStr = isBlank(openAIOpts.apitoken) ? "(not set)" : "********";
        let maxTokensStr = String(
            openAIOpts.maxtokens == null || openAIOpts.maxtokens == 0 ? 1000 : openAIOpts.maxtokens
        );
        let curFontSize = GlobalModel.termFontSize.get();

        return (
            <div className={cn("clientsettings-view")}>
                <header className="header">
                    <div className="clientsettings-title text-primary">Client Settings</div>
                </header>
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
                        {VERSION} {BUILD}
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
                        <Toggle checked={!cdata.clientopts.noreleasecheck} onChange={this.handleChangeReleaseCheck} />
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
                <SettingsError errorMessage={this.errorMessage} />
            </div>
        );
    }
}

export { ClientSettingsView };
