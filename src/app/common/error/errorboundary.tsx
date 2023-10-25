import React, { Component, ReactNode } from "react";
import { RendererContext } from "../../../plugins/types/types";
import cn from "classnames";
import "./errorboundary.less";

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

interface ErrorBoundaryProps {
    children: ReactNode;
    plugin?: string;
    lineContext?: RendererContext;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false,
        error: null,
    };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        const { plugin, lineContext } = this.props;

        if (plugin && lineContext) {
            console.log(`Plugin Name: ${plugin}\n`);
            console.log(`Line Context: \n`);
            console.log(`${JSON.stringify(lineContext, null, 4)}\n`);
        }

        console.log(`Error: ${error.message}\n`);
        console.log(`Stack Trace: \n`);

        const { componentStack } = errorInfo;
        if (componentStack) {
            const stackLines = componentStack.split("\n").filter((line) => line.trim() !== "");

            stackLines.forEach((line) => {
                console.log(line.trim());
            });
        }
    }

    resetErrorBoundary = (): void => {
        this.setState({ hasError: false, error: null });
    };

    renderFallback() {
        const { error } = this.state;
        const { plugin } = this.props;

        return (
            <div className={cn("load-error-text", { "screen-view-error": !plugin })}>
                <div>{`${error?.message}`}</div>
                {plugin && <div>An error occurred in the {plugin} plugin</div>}
            </div>
        );
    }

    render() {
        const { hasError } = this.state;

        if (hasError) {
            return this.renderFallback();
        }

        return this.props.children;
    }
}

export { ErrorBoundary };
