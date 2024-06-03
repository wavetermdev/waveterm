// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { ReactNode } from "react";

export class ErrorBoundary extends React.Component<{ children: ReactNode }, { error: Error }> {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.setState({ error: error });
    }

    render() {
        const { error } = this.state;
        if (error) {
            const errorMsg = `Error: ${error?.message}\n\n${error?.stack}`;
            return <pre className="error-boundary">{errorMsg}</pre>;
        } else {
            return <>{this.props.children}</>;
        }
    }
}
