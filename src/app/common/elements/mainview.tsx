// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import { GlobalModel } from "@/models";

import "./mainview.less";

@mobxReact.observer
class MainView extends React.Component<{
    viewName: string;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}> {
    render() {
        const isHidden = GlobalModel.activeMainView.get() != this.props.viewName;
        if (isHidden) {
            return null;
        }

        // TODO: This is a workaround for History view not honoring the sidebar width. This is rooted in the table width for the history view, which uses `calc(100%-20px)`. To properly fix this, History view needs a full overhaul.
        const width = window.innerWidth - 6 - GlobalModel.mainSidebarModel.getWidth();

        return (
            <div className={cn("mainview", `${this.props.viewName}-view`)} style={{ maxWidth: width }}>
                <div className="header-container bottom-border">
                    <header className="header">
                        <div className="title text-primary">{this.props.title}</div>
                        <div className="close-div hoverEffect" title="Close (Escape)" onClick={this.props.onClose}>
                            <i className="fa-sharp fa-solid fa-xmark"></i>
                        </div>
                    </header>
                </div>
                {this.props.children}
            </div>
        );
    }
}

export { MainView };
