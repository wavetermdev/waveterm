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
import { boundMethod } from "autobind-decorator";

import "./right.less";

dayjs.extend(localizedFormat);

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

class SidebarKeyBindings extends React.Component<{ component: RightSideBar }, {}> {
    componentDidMount(): void {
        const { component } = this.props;
        const keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("pane", "rightsidebar", "rightsidebar:toggle", (waveEvent) => {
            return component.toggleCollapse();
        });
    }

    componentDidUpdate(): void {
        // remove for now (needs to take into account right sidebar focus so it doesn't conflict with other ESC keybindings)
    }

    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("rightsidebar");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class RightSideBar extends React.Component<
    {
        parentRef: React.RefObject<HTMLElement>;
    },
    {}
> {
    mode: OV<string> = mobx.observable.box("aichat", { name: "RightSideBar-mode" });
    timeoutId: NodeJS.Timeout = null;

    constructor(props) {
        super(props);
        mobx.makeObservable(this);
    }

    componentWillUnmount() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    @mobx.action.bound
    setMode(mode: string) {
        if (mode == this.mode.get()) {
            return;
        }
        this.mode.set(mode);
    }

    @mobx.action.bound
    toggleCollapse() {
        const isCollapsed = GlobalModel.rightSidebarModel.getCollapsed();
        GlobalModel.rightSidebarModel.setCollapsed(!isCollapsed);
        if (this.mode.get() == "aichat") {
            if (isCollapsed) {
                this.timeoutId = setTimeout(() => {
                    GlobalModel.inputModel.setChatSidebarFocus();
                }, 100);
            } else {
                GlobalModel.inputModel.setChatSidebarFocus(false);
            }
        }
        return true;
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
                {() => (
                    <React.Fragment>
                        <SidebarKeyBindings component={this} />
                        <div className="header">
                            <div className="rsb-modes">
                                <div
                                    className="icon-container"
                                    title="Show Keybinding Debugger"
                                    onClick={() => this.setMode("aichat")}
                                >
                                    <i className="fa-sharp fa-regular fa-sparkles fa-fw" />
                                    <span>Wave AI</span>
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
                            </div>
                            <Button className="secondary ghost close" onClick={this.toggleCollapse}>
                                <i className="fa-sharp fa-solid fa-xmark-large" />
                            </Button>
                        </div>
                        <If condition={this.mode.get() == "keybind"}>
                            <KeybindDevPane></KeybindDevPane>
                        </If>
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
