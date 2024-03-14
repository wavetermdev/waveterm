// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import { GlobalModel } from "@/models";

import "./mainview.less";

@mobxReact.observer
class MainView extends React.Component<{
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
}> {
    render() {
        const sidebarModel = GlobalModel.mainSidebarModel;
        const maxWidthSubtractor = sidebarModel.getCollapsed() ? 0 : sidebarModel.getWidth();
        return (
            <div
                className={cn("mainview", this.props.className)}
                style={{ maxWidth: `calc(100vw - ${maxWidthSubtractor}px)` }}
            >
                <div className="header-container bottom-border">
                    <header className="header">
                        <div className="title text-primary">{this.props.title}</div>
                        <div className="close-div hoverEffect" title="Close (Escape)" onClick={this.props.onClose}>
                            <i className="fa-sharp fa-solid fa-xmark"></i>
                        </div>
                    </header>
                </div>
                <div className="mainview-content">{this.props.children}</div>
            </div>
        );
    }
}

export { MainView };
