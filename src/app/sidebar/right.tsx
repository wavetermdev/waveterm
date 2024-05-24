// Copyright 2023-2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import dayjs from "dayjs";
import { If, For } from "tsx-control-statements/components";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { ResizableSidebar, Button } from "@/elements";
import { WaveBookDisplay } from "./wavebook";
import { ChatSidebar } from "./aichat";

import "./right.less";

dayjs.extend(localizedFormat);

interface RightSideBarProps {
    parentRef: React.RefObject<HTMLElement>;
}

@mobxReact.observer
class KeybindDevPane extends React.Component<{}, {}> {
    render() {
        let curActiveKeybinds: Array<{ name: string; domains: Array<string> }> =
            GlobalModel.keybindManager.getActiveKeybindings();
        let keybindLevel: { name: string; domains: Array<string> } = null;
        let domain: string = null;
        let curVersion = GlobalModel.keybindManager.getActiveKeybindsVersion().get();
        let levelIdx: number = 0;
        let domainIdx: number = 0;
        let lastKeyData = GlobalModel.keybindManager.getLastKeyData();
        return (
            <div className="keybind-debug-pane">
                <div className="keybind-pane-title">Keybind Manager</div>
                <For index="levelIdx" each="keybindLevel" of={curActiveKeybinds}>
                    <div className="keybind-level" key={"level-" + curVersion + levelIdx}>
                        {keybindLevel.name}
                    </div>
                    <For index="domainIdx" each="domain" of={keybindLevel.domains}>
                        <div className="keybind-domain" key={"domain-" + curVersion + domainIdx}>
                            {domain}
                        </div>
                    </For>
                </For>
                <br />
                <br />
                <div>
                    <h1>Last KeyPress Domain: {lastKeyData.domain}</h1>
                    <h1>Last KeyPress key: {lastKeyData.keyPress}</h1>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class RightSideBar extends React.Component<RightSideBarProps, {}> {
    mode: OV<string> = mobx.observable.box("aichat", { name: "RightSideBar-mode" });

    setMode(mode: string) {
        mobx.action(() => {
            this.mode.set(mode);
        })();
    }

    render() {
        const isCollapsed = GlobalModel.rightSidebarModel.getCollapsed();
        const mode = this.mode.get();
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
                            <div className="rsb-modes">
                                <div
                                    className="icon-container"
                                    title="Show Keybinding Debugger"
                                    onClick={() => this.setMode("ai")}
                                >
                                    <i className="fa-sharp fa-regular fa-sparkles fa-fw" />
                                </div>
                                <div className="flex-spacer" />
                                <If condition={GlobalModel.isDev}>
                                    <div
                                        className="icon-container"
                                        title="Show Keybinding Debugger"
                                        onClick={() => this.setMode("keybind")}
                                    >
                                        <i className="fa-fw fa-sharp fa-keyboard fa-solid" />
                                    </div>
                                </If>
                                <div
                                    className="icon-container"
                                    title="Show Keybinding Debugger"
                                    onClick={() => this.setMode("wavebook")}
                                >
                                    <i className="fa-sharp fa-solid fa-book-sparkles"></i>
                                </div>
                            </div>
                            <Button className="secondary ghost" onClick={toggleCollapse}>
                                <i className="fa-sharp fa-regular fa-xmark"></i>
                            </Button>
                        </div>
                        {/* <If condition={this.mode.get() == "keybind"}>
                            <KeybindDevPane></KeybindDevPane>
                        </If> */}
                        <If condition={mode == "wavebook"}>
                            <WaveBookDisplay></WaveBookDisplay>
                        </If>
                        <If condition={mode == "aichat" && !isCollapsed}>
                            <ChatSidebar />
                        </If>
                    </React.Fragment>
                )}
            </ResizableSidebar>
        );
    }
}

export { RightSideBar };
