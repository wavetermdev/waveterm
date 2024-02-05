// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel, GlobalCommandRunner } from "../../../model/model";
import { SettingsError, Modal, Dropdown } from "../common";
import { LineType, RendererPluginType } from "../../../types/types";
import { PluginModel } from "../../../plugins/plugins";
import { commandRtnHandler } from "../../../util/util";

import "./linesettings.less";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class LineSettingsModal extends React.Component<{}, {}> {
    rendererDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "lineSettings-rendererDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });
    linenum: number;

    constructor(props: any) {
        super(props);
        this.linenum = GlobalModel.lineSettingsModal.get();
        if (this.linenum == null) {
            return;
        }
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.lineSettingsModal.set(null);
        })();
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    handleChangeArchived(val: boolean): void {
        let line = this.getLine();
        if (line == null) {
            return;
        }
        let prtn = GlobalCommandRunner.lineArchive(line.lineid, val);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    toggleRendererDropdown(): void {
        mobx.action(() => {
            this.rendererDropdownActive.set(!this.rendererDropdownActive.get());
        })();
    }

    getLine(): LineType {
        let screen = GlobalModel.getActiveScreen();
        if (screen == null) {
            return;
        }
        return screen.getLineByNum(this.linenum);
    }

    @boundMethod
    clickSetRenderer(renderer: string): void {
        let line = this.getLine();
        if (line == null) {
            return;
        }
        let prtn = GlobalCommandRunner.lineSet(line.lineid, { renderer: renderer });
        commandRtnHandler(prtn, this.errorMessage);
        mobx.action(() => {
            this.rendererDropdownActive.set(false);
        })();
    }

    getOptions(plugins: RendererPluginType[]) {
        // Add label and value to each object in the array
        const options = plugins.map((item) => ({
            ...item,
            label: item.name,
            value: item.name,
        }));

        // Create an additional object with label "terminal" and value null
        const terminalItem = {
            label: "terminal",
            value: null,
            name: null,
            rendererType: null,
            heightType: null,
            dataType: null,
            collapseType: null,
            globalCss: null,
            mimeTypes: null,
        };

        // Create an additional object with label "none" and value none
        const noneItem = {
            label: "none",
            value: "none",
            name: null,
            rendererType: null,
            heightType: null,
            dataType: null,
            collapseType: null,
            globalCss: null,
            mimeTypes: null,
        };

        // Combine the options with the terminal item
        return [terminalItem, ...options, noneItem];
    }

    render() {
        let line = this.getLine();
        if (line == null) {
            setTimeout(() => {
                this.closeModal();
            }, 0);
            return null;
        }
        let plugins = PluginModel.rendererPlugins;
        let renderer = line.renderer ?? "terminal";

        return (
            <Modal className="line-settings-modal">
                <Modal.Header onClose={this.closeModal} title={`line settings (${line.linenum})`} />
                <div className="wave-modal-body">
                    <div className="settings-field">
                        <div className="settings-label">Renderer</div>
                        <div className="settings-input">
                            <Dropdown
                                className="renderer-dropdown"
                                options={this.getOptions(plugins)}
                                defaultValue={renderer}
                                onChange={this.clickSetRenderer}
                            />
                        </div>
                    </div>
                    <SettingsError errorMessage={this.errorMessage} />
                    <div style={{ height: 50 }} />
                </div>
                <Modal.Footer cancelLabel="Close" onCancel={this.closeModal} />
            </Modal>
        );
    }
}

export { LineSettingsModal };
