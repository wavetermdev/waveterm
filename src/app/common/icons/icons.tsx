import React from "react";
import { StatusIndicatorLevel } from "../../../types/types";
import cn from "classnames";

interface PositionalIconProps {
    children?: React.ReactNode;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export class FrontIcon extends React.Component<PositionalIconProps> {
    render() {
        return (
            <div className={cn("front-icon", "positional-icon", this.props.className)}>
                <div className="positional-icon-inner">{this.props.children}</div>
            </div>
        );
    }
}

export class CenteredIcon extends React.Component<PositionalIconProps> {
    render() {
        return (
            <div className={cn("centered-icon", "positional-icon", this.props.className)} onClick={this.props.onClick}>
                <div className="positional-icon-inner">{this.props.children}</div>
            </div>
        );
    }
}

interface ActionsIconProps {
    onClick: React.MouseEventHandler<HTMLDivElement>;
}

export class ActionsIcon extends React.Component<ActionsIconProps> {
    render() {
        return (
            <CenteredIcon className="actions" onClick={this.props.onClick}>
                <div className="icon hoverEffect fa-sharp fa-solid fa-1x fa-ellipsis-vertical"></div>
            </CenteredIcon>
        );
    }
}

interface StatusIndicatorProps {
    level: StatusIndicatorLevel;
    className?: string;
}

export class StatusIndicator extends React.Component<StatusIndicatorProps> {
    render() {
        const statusIndicatorLevel = this.props.level;
        let statusIndicator = null;
        if (statusIndicatorLevel != StatusIndicatorLevel.None) {
            let statusIndicatorClass = null;
            switch (statusIndicatorLevel) {
                case StatusIndicatorLevel.Output:
                    statusIndicatorClass = "output";
                    break;
                case StatusIndicatorLevel.Success:
                    statusIndicatorClass = "success";
                    break;
                case StatusIndicatorLevel.Error:
                    statusIndicatorClass = "error";
                    break;
            }
            statusIndicator = (
                <CenteredIcon className={cn(this.props.className, "status-indicator")}>
                    <div className={cn(statusIndicatorClass, "fa-sharp", "fa-solid", "fa-circle-small")}></div>
                </CenteredIcon>
            );
        }
        return statusIndicator;
    }
}
