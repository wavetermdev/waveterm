// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { PluginModel } from "../plugins/plugins";
import { RendererPluginType } from "../types/types";
import { OV } from "../types/types";
import { CommandRunner } from "./commandrunner";
import { Model } from "./model";

class PluginsModel {
    globalCommandRunner: CommandRunner = null;
    globalModel: Model = null;
    selectedPlugin: OV<RendererPluginType> = mobx.observable.box(null, { name: "selectedPlugin" });

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        this.globalCommandRunner = CommandRunner.getInstance();
    }

    showPluginsView(): void {
        PluginModel.loadAllPluginResources();
        mobx.action(() => {
            this.reset();
            this.globalModel.activeMainView.set("plugins");
            const allPlugins = PluginModel.allPlugins();
            this.selectedPlugin.set(allPlugins.length > 0 ? allPlugins[0] : null);
        })();
    }

    setSelectedPlugin(plugin: RendererPluginType): void {
        mobx.action(() => {
            this.selectedPlugin.set(plugin);
        })();
    }

    reset(): void {
        mobx.action(() => {
            this.selectedPlugin.set(null);
        })();
    }

    closeView(): void {
        this.globalModel.showSessionView();
        setTimeout(() => this.globalModel.inputModel.giveFocus(), 50);
    }
}

export { PluginsModel };
