// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import ReactDOM from "react-dom";

import "./tooltip.less";

interface TooltipProps {
    message: React.ReactNode;
    icon?: React.ReactNode; // Optional icon property
    children: React.ReactNode;
    className?: string;
}

interface TooltipState {
    isVisible: boolean;
}

@mobxReact.observer
class Tooltip extends React.Component<TooltipProps, TooltipState> {
    iconRef: React.RefObject<HTMLDivElement>;

    constructor(props: TooltipProps) {
        super(props);
        this.state = {
            isVisible: false,
        };
        this.iconRef = React.createRef();
    }

    @boundMethod
    showBubble() {
        this.setState({ isVisible: true });
    }

    @boundMethod
    hideBubble() {
        this.setState({ isVisible: false });
    }

    @boundMethod
    calculatePosition() {
        // Get the position of the icon element
        const iconElement = this.iconRef.current;
        if (iconElement) {
            const rect = iconElement.getBoundingClientRect();
            return {
                top: `${rect.bottom + window.scrollY - 29}px`,
                left: `${rect.left + window.scrollX + rect.width / 2 - 17.5}px`,
            };
        }
        return {};
    }

    @boundMethod
    renderBubble() {
        if (!this.state.isVisible) return null;

        const style = this.calculatePosition();

        return ReactDOM.createPortal(
            <div className={cn("wave-tooltip", this.props.className)} style={style}>
                {this.props.icon && <div className="wave-tooltip-icon">{this.props.icon}</div>}
                <div className="wave-tooltip-message">{this.props.message}</div>
            </div>,
            document.getElementById("app")!
        );
    }

    render() {
        return (
            <div onMouseEnter={this.showBubble} onMouseLeave={this.hideBubble} ref={this.iconRef}>
                {this.props.children}
                {this.renderBubble()}
            </div>
        );
    }
}

export { Tooltip };
