// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { clsx } from "clsx";
import { GlobalModel } from "@/models";

import "./mainview.less";
import { Choose, If, Otherwise, When } from "tsx-control-statements/components";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

@mobxReact.observer
class MainView extends React.Component<{
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
    scrollable?: boolean;
    onScrollbarInitialized?: () => void;
}> {
    render() {
        const sidebarModel = GlobalModel.mainSidebarModel;
        const maxWidthSubtractor = sidebarModel.getCollapsed() ? 0 : sidebarModel.getWidth();
        return (
            <div
                className={clsx("mainview", this.props.className)}
                style={{ maxWidth: `calc(100vw - ${maxWidthSubtractor}px)` }}
            >
                <div className="header-container">
                    <header className="header">
                        <div className="title text-primary">{this.props.title}</div>
                        <div className="close-div hoverEffect" title="Close (Escape)" onClick={this.props.onClose}>
                            <i className="fa-sharp fa-solid fa-xmark"></i>
                        </div>
                    </header>
                </div>
                <Choose>
                    <When condition={this.props.scrollable}>
                        <OverlayScrollbarsComponent
                            className="mainview-content"
                            options={{ scrollbars: { autoHide: "leave" } }}
                            defer={true}
                            events={{ initialized: this.props.onScrollbarInitialized }}
                        >
                            {this.props.children}
                        </OverlayScrollbarsComponent>
                    </When>
                    <Otherwise>
                        <div className="mainview-content">{this.props.children}</div>
                    </Otherwise>
                </Choose>
            </div>
        );
    }
}

export { MainView };
