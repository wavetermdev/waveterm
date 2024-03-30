// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { boundMethod } from "autobind-decorator";

import "./toggle.less";

class Toggle extends React.PureComponent<{ checked: boolean; onChange: (value: boolean) => void }, {}> {
    @boundMethod
    handleChange(e: any): void {
        let { onChange } = this.props;
        if (onChange != null) {
            onChange(e.target.checked);
        }
    }

    render() {
        return (
            <label className="checkbox-toggle">
                <input type="checkbox" checked={this.props.checked} onChange={this.handleChange} />
                <span className="slider" />
            </label>
        );
    }
}

export { Toggle };
