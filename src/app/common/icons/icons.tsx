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
    runningCommands?: boolean;
}

export class StatusIndicator extends React.Component<StatusIndicatorProps> {
    render() {
        const {level, className, runningCommands} = this.props;
        let statusIndicator = null;
        if (level != StatusIndicatorLevel.None || runningCommands) {
            let levelClass = null;
            switch (level) {
                case StatusIndicatorLevel.Output:
                    levelClass = "output";
                    break;
                case StatusIndicatorLevel.Success:
                    levelClass = "success";
                    break;
                case StatusIndicatorLevel.Error:
                    levelClass = "error";
                    break;
            }
            const runningCommandsClass = runningCommands ? "running-commands" : "";
            statusIndicator = (
                <CenteredIcon className={cn(className, "status-indicator")}>
                    <div className={cn(levelClass, runningCommandsClass)}>
                        <div className="fa-sharp fa-solid fa-circle-small"></div>
                        <div className="fa-sharp fa-solid fa-spinner-third spin"></div>
                    </div>
                </CenteredIcon>
            );
        }
        return statusIndicator;
    }
}
