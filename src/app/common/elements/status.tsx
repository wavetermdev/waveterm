// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { boundMethod } from "autobind-decorator";

import "./status.less";

interface StatusProps {
    status: "green" | "red" | "gray" | "yellow";
    text: string;
}

class Status extends React.PureComponent<StatusProps> {
    @boundMethod
    renderDot() {
        const { status } = this.props;

        return <div className={`dot ${status}`} />;
    }

    render() {
        const { text } = this.props;

        return (
            <div className="wave-status-container">
                {this.renderDot()}
                <span>{text}</span>
            </div>
        );
    }
}

export { Status };
