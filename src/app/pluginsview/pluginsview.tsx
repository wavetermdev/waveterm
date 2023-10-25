// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel } from "../../model/model";

import { ReactComponent as XmarkIcon } from "../assets/icons/line/xmark.svg";

import "./pluginsview.less";

@mobxReact.observer
class PluginsView extends React.Component<{}, {}> {
    @boundMethod
    closeView(): void {
        GlobalModel.bookmarksModel.closeView();
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
                <div className="plugins-list"></div>
            </div>
        );
    }
}

export { PluginsView };
