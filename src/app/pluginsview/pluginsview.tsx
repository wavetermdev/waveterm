// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel } from "../../model/model";
import { PluginModel } from "../../plugins/plugins";
import { Markdown } from "../common/elements";

import { ReactComponent as XmarkIcon } from "../assets/icons/line/xmark.svg";

import "./pluginsview.less";

@mobxReact.observer
class PluginsView extends React.Component<{}, {}> {
    @boundMethod
    closeView(): void {
        GlobalModel.pluginsModel.closeView();
    }

    renderPluginIcon(plugin): any {
        let Comp = plugin.iconComp;
        return <Comp />;
    }

    render() {
        if (GlobalModel.activeMainView.get() !== "plugins") {
            return <></>;
        }
        const { pluginsModel } = GlobalModel;
        const PluginList = () => (
            <div className="plugins-list">
                {PluginModel.allPlugins().map((plugin, i) => (
                    <div
                        key={i}
                        className={`plugin-summary hoverEffect ${
                            plugin.name === pluginsModel.selectedPlugin.get().name ? "selected" : ""
                        }`}
                        onClick={() => pluginsModel.setSelectedPlugin(plugin)}
                    >
                        <div className="plugin-summary-header">
                            <div className="plugin-summary-icon">{this.renderPluginIcon(plugin)}</div>
                            <div className="plugin-summary-info">
                                <div className="plugin-summary-title">{plugin.title}</div>
                                <div className="plugin-summary-vendor">{plugin.vendor}</div>
                            </div>
                        </div>
                        <div className="plugin-summary-body">{plugin.summary}</div>
                    </div>
                ))}
            </div>
        );

        const PluginDetails = () => {
            const plugin = pluginsModel.selectedPlugin.get();
            return (
                <div className="plugins-details">
                    <div className="plugin-summary-header">
                        <div className="plugin-summary-icon">{this.renderPluginIcon(plugin)}</div>
                        <div className="plugin-summary-info">
                            <div className="plugin-summary-title">{plugin.title}</div>
                            <div className="plugin-summary-vendor">{plugin.vendor}</div>
                        </div>
                    </div>
                    <div className="plugin-summary-body">{plugin.summary}</div>
                    {plugin.screenshots && plugin.screenshots.length > 0 && (
                        <div className="plugin-screenshots-container">
                            <div className="plugin-label">{"Screenshots"}</div>
                            <div className="plugin-screenshots">
                                {plugin.screenshots.map((path, index) => (
                                    <img key={index} src={path} alt={`Screenshot ${index}`} />
                                ))}
                            </div>
                        </div>
                    )}
                    {plugin.readme && (
                        <div className="plugin-readme">
                            <div className="plugin-label">{"Readme"}</div>
                            <Markdown text={plugin.readme} />
                        </div>
                    )}
                </div>
            );
        };

        return (
            <div className="plugins-view">
                <div className="header">
                    <div className="plugins-title">Apps</div>
                    <div className="close-button hoverEffect" title="Close (Escape)" onClick={this.closeView}>
                        <XmarkIcon className={"icon"} />
                    </div>
                </div>
                <div className="body">
                    <PluginList />
                    <PluginDetails />
                </div>
            </div>
        );
    }
}

export { PluginsView };
