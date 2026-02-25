// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { ReactNode } from "react";

export class ErrorBoundary extends React.Component<
    { children: ReactNode; fallback?: React.ReactElement & { error?: Error } },
    { error: Error }
> {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ error: error });
    }

    render() {
        const { fallback } = this.props;
        const { error } = this.state;
        if (error) {
            if (fallback != null) {
                return React.cloneElement(fallback as any, { error });
            }
            const errorMsg = `Error: ${error?.message}\n\n${error?.stack}`;
            return <pre className="error-boundary">{errorMsg}</pre>;
        } else {
            return <>{this.props.children}</>;
        }
    }
}

export class NullErrorBoundary extends React.Component<
    { children: React.ReactNode; debugName?: string },
    { hasError: boolean }
> {
    constructor(props: { children: React.ReactNode; debugName?: string }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`${this.props.debugName ?? "NullErrorBoundary"} error boundary caught error`, error, info);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}
