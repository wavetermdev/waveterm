// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-preact";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";

@mobxReact.observer
class SettingsError extends React.PureComponent<{ errorMessage: OV<string> }, {}> {
    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.props.errorMessage.set(null);
        })();
    }

    render() {
        if (this.props.errorMessage.get() == null) {
            return null;
        }
        return (
            <div className="settings-field settings-error">
                <div>Error: {this.props.errorMessage.get()}</div>
                <div className="flex-spacer" />
                <div onClick={this.dismissError} className="error-dismiss">
                    <i className="fa-sharp fa-solid fa-xmark" />
                </div>
            </div>
        );
    }
}

export { SettingsError };
