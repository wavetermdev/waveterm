// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import "./errorfallback.less";

class ErrorFallback extends React.Component<
    {
        error: any;
    },
    {}
> {
    componentDidMount() {
        // save error to server
    }

    render() {
        const lines = this.props.error.stack.toString().split("\n");

        return (
            <div className="stack-trace">
                {lines.map((line: string, index: number) => (
                    <div key={index} className="load-error-text">
                        {line.trim()}
                    </div>
                ))}
            </div>
        );
    }
}

export { ErrorFallback };
