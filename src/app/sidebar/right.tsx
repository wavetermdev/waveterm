// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import dayjs from "dayjs";
import { If, For } from "tsx-control-statements/components";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { ResizableSidebar, Button } from "@/elements";

import "./right.less";

dayjs.extend(localizedFormat);

interface RightSideBarProps {
    parentRef: React.RefObject<HTMLElement>;
    clientData: ClientDataType;
}

@mobxReact.observer
class KeybindDevPane extends React.Component<{}, {}> {
    render() {
        let curActiveKeybinds: Array<{ name: string; domains: Array<string> }> =
            GlobalModel.keybindManager.getActiveKeybindings();
        let keybindLevel: { name: string; domains: Array<string> } = null;
        let domain: string = null;
        let curVersion = GlobalModel.keybindManager.getActiveKeybindsVersion();
        let levelIdx: number = 0;
        let domainIdx: number = 0;
        return (
            <For index="levelIdx" each="keybindLevel" of={curActiveKeybinds}>
                <h1 key={"level-" + curVersion + levelIdx}>Level: {keybindLevel.name}</h1>
                <For index="domainIdx" each="domain" of={keybindLevel.domains}>
                    <h4 key={"domain-" + curVersion + domainIdx}>&emsp;&emsp;{domain}</h4>
                </For>
            </For>
        );
    }
}

@mobxReact.observer
class RightSideBar extends React.Component<RightSideBarProps, {}> {
    render() {
        return (
            <ResizableSidebar
                model={GlobalModel.rightSidebarModel}
                className="right-sidebar"
                position="right"
                enableSnap={true}
                parentRef={this.props.parentRef}
            >
                {(toggleCollapse) => (
                    <React.Fragment>
                        <div className="header">
                            <Button className="secondary ghost" onClick={toggleCollapse}>
                                <i className="fa-sharp fa-regular fa-xmark"></i>
                            </Button>
                        </div>
                        <If condition={GlobalModel.isDev}>
                            <KeybindDevPane></KeybindDevPane>
                        </If>
                    </React.Fragment>
                )}
            </ResizableSidebar>
        );
    }
}

export { RightSideBar };
