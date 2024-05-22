// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { isBlank } from "@/util/util";

import "./aicmdinfo.less";
import { AuxiliaryCmdView } from "./auxview";

@mobxReact.observer
class AICmdInfo extends React.Component<{}, {}> {
    lastClickHNum: string = null;
    lastClickTs: number = 0;
    containingText: mobx.IObservableValue<string> = mobx.observable.box("");

    @mobx.action.bound
    handleClose() {
        GlobalModel.inputModel.closeAuxView();
    }

    render() {
        const cmd = GlobalModel.sidebarchatModel.cmdToExec;

        return (
            <AuxiliaryCmdView
                title="Command from Wave AI"
                className="cmd-to-execute"
                onClose={this.handleClose}
                iconClass="fa-sharp fa-solid fa-sparkles"
                scrollable={true}
            >
                <pre>{cmd}</pre>
            </AuxiliaryCmdView>
        );
    }
}

export { AICmdInfo };
