// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import * as appconst from "@/app/appconst";
import { If } from "tsx-control-statements/components";

import "./aicmdinfo.less";
import { AuxiliaryCmdView } from "./auxview";

class AICmdInfoKeybindings extends React.Component<{}, {}> {
    componentDidMount(): void {
        if (GlobalModel.activeMainView != "session") {
            return;
        }
        const keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("pane", "aicmdinfo", "generic:cancel", (waveEvent) => {
            GlobalModel.inputModel.closeAuxView();
            return true;
        });
    }

    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("aicmdinfo");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class AICmdInfo extends React.Component<{}, {}> {
    @mobx.action.bound
    handleClose() {
        GlobalModel.inputModel.closeAuxView();
    }

    render() {
        const cmd = GlobalModel.sidebarchatModel.cmdToExec;
        const renderKeybindings = GlobalModel.inputModel.shouldRenderAuxViewKeybindings(
            appconst.InputAuxView_AICmdInfo
        );

        return (
            <AuxiliaryCmdView
                title="Command from Wave AI"
                className="cmd-to-execute"
                onClose={this.handleClose}
                iconClass="fa-sharp fa-solid fa-sparkles"
                scrollable={true}
            >
                <If condition={renderKeybindings}>
                    <AICmdInfoKeybindings />
                </If>
                <pre>{cmd}</pre>
            </AuxiliaryCmdView>
        );
    }
}

export { AICmdInfo };
