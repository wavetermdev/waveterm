// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel } from "../../model/model";
import { PluginModel } from "../../plugins/plugins";

import { ReactComponent as XmarkIcon } from "../assets/icons/line/xmark.svg";

import "./pluginsview.less";

@mobxReact.observer
class PluginsView extends React.Component<{}, {}> {
    @boundMethod
    closeView(): void {
        GlobalModel.bookmarksModel.closeView();
    }

    async getSVG(path: string) {
        // '../../plugins/markdown/icon.svg'
        const icon = await import(path);
        return icon.ReactComponent;
    }

    render() {
        if (GlobalModel.activeMainView.get() !== "plugins") {
            return <></>;
        }
        return (
            <div className="plugins-view">
                <div className="header">
                    <div className="plugins-title">Apps</div>
                    <div className="close-button hoverEffect" title="Close (Escape)" onClick={this.closeView}>
                        <XmarkIcon className={"icon"} />
                    </div>
                </div>
                <div className="body">
                    <div className="plugins-list">
                        {PluginModel.allPlugins().map(({ title, vendor, summary, getIcon }, i) => (
                            <div key={i} className="plugin-summary">
                                <div className="plugin-summary-header">
                                    <div className="plugin-summary-icon">{getIcon()}</div>
                                    <div className="plugin-summary-info">
                                        <div className="plugin-summary-title">{title}</div>
                                        <div className="plugin-summary-vendor">{vendor}</div>
                                    </div>
                                </div>
                                <div className="plugin-summary-body">{summary}</div>
                            </div>
                        ))}
                    </div>
                    <div className="plugins-details"></div>
                </div>
            </div>
        );
    }
}

export { PluginsView };
