import React from "react";
import { StatusIndicatorLevel } from "../../../types/types";
import cn from "classnames";
import { ReactComponent as SpinnerIndicator } from "../../assets/icons/spinner-indicator.svg";
import { boundMethod } from "autobind-decorator";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";

import { ReactComponent as RotateIconSvg } from "../../assets/icons/line/rotate.svg";

interface PositionalIconProps {
    children?: React.ReactNode;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    divRef?: React.RefObject<HTMLDivElement>;
}

export class FrontIcon extends React.Component<PositionalIconProps> {
    render() {
        return (
            <div
                ref={this.props.divRef}
                className={cn("front-icon", "positional-icon", this.props.className)}
                onClick={this.props.onClick}
            >
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

class SyncSpin extends React.Component<{
    classRef?: React.RefObject<HTMLDivElement>;
    children?: React.ReactNode;
    shouldSync?: boolean;
}> {
    listenerAdded: boolean = false;

    componentDidMount() {
        this.syncSpinner();
    }

    componentDidUpdate() {
        this.syncSpinner();
    }

    componentWillUnmount(): void {
        const classRef = this.props.classRef;
        if (classRef.current != null && this.listenerAdded) {
            const elem = classRef.current;
            const svgElem = elem.querySelector("svg");
            if (svgElem != null) {
                svgElem.removeEventListener("animationstart", this.handleAnimationStart);
            }
        }
    }

    @boundMethod
    handleAnimationStart(e: AnimationEvent) {
        const classRef = this.props.classRef;
        if (classRef.current == null) {
            return;
        }
        const svgElem = classRef.current.querySelector("svg");
        if (svgElem == null) {
            return;
        }
        const animArr = svgElem.getAnimations();
        if (animArr == null || animArr.length == 0) {
            return;
        }
        animArr[0].startTime = 0;
    }

    syncSpinner() {
        const { classRef, shouldSync } = this.props;
        const shouldSyncVal = shouldSync ?? true;
        if (!shouldSyncVal || classRef.current == null) {
            return;
        }
        const elem = classRef.current;
        const svgElem = elem.querySelector("svg");
        if (svgElem == null) {
            return;
        }
        if (!this.listenerAdded) {
            svgElem.addEventListener("animationstart", this.handleAnimationStart);
            this.listenerAdded = true;
        }
        const animArr = svgElem.getAnimations();
        if (animArr == null || animArr.length == 0) {
            return;
        }
        animArr[0].startTime = 0;
    }

    render() {
        return this.props.children;
    }
}

interface StatusIndicatorProps {
    /**
     * The level of the status indicator. This will determine the color of the status indicator.
     */
    level: StatusIndicatorLevel;
    className?: string;
    /**
     * If true, a spinner will be shown around the status indicator.
     */
    runningCommands?: boolean;
}

/**
 * This component is used to show the status of a command. It will show a spinner around the status indicator if there are running commands. It will also delay showing the spinner for a short time to prevent flickering.
 */
@mobxReact.observer
export class StatusIndicator extends React.Component<StatusIndicatorProps> {
    iconRef: React.RefObject<HTMLDivElement> = React.createRef();
    spinnerVisible: mobx.IObservableValue<boolean> = mobx.observable.box(false);
    timeout: NodeJS.Timeout;

    /**
     * This will apply a delay after there is a running command before showing the spinner. This prevents flickering for commands that return quickly.
     */
    updateMountCallback() {
        const runningCommands = this.props.runningCommands ?? false;
        if (runningCommands && !this.timeout) {
            this.timeout = setTimeout(
                mobx.action(() => {
                    this.spinnerVisible.set(true);
                }),
                1000
            );
        } else if (!runningCommands && this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }

    componentDidUpdate(): void {
        this.updateMountCallback();
    }

    componentDidMount(): void {
        this.updateMountCallback();
    }

    componentWillUnmount(): void {
        mobx.action(() => {
            this.spinnerVisible.set(false);
        })();
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }

    render() {
        const { level, className, runningCommands } = this.props;
        let statusIndicator = null;
        const spinnerVisibleClass = this.spinnerVisible.get() ? "spinner-visible" : null;
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

            statusIndicator = (
                <CenteredIcon
                    divRef={this.iconRef}
                    className={cn(className, levelClass, spinnerVisibleClass, "status-indicator")}
                >
                    <SpinnerIndicator className={runningCommands ? "spin" : null} />
                </CenteredIcon>
            );
        }
        return (
            <SyncSpin classRef={this.iconRef} shouldSync={runningCommands}>
                {statusIndicator}
            </SyncSpin>
        );
    }
}

export class RotateIcon extends React.Component<{
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
}> {
    iconRef: React.RefObject<HTMLDivElement> = React.createRef();
    render() {
        return (
            <SyncSpin classRef={this.iconRef}>
                <RotateIconSvg className={this.props.className ?? ""} />
            </SyncSpin>
        );
    }
}
