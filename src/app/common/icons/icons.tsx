import React from "react";
import cn from "classnames";
import { ReactComponent as SpinnerIndicator } from "@/assets/icons/spinner-indicator.svg";
import * as appconst from "@/app/appconst";

import { ReactComponent as RotateIconSvg } from "@/assets/icons/line/rotate.svg";

interface PositionalIconProps {
    children?: React.ReactNode;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    divRef?: React.RefObject<HTMLDivElement>;
}

export const FrontIcon: React.FC<PositionalIconProps> = (props) => {
    return (
        <div
            ref={props.divRef}
            className={cn("front-icon", "positional-icon", props.className)}
            onClick={props.onClick}
        >
            <div className="positional-icon-inner">{props.children}</div>
        </div>
    );
};

export const CenteredIcon: React.FC<PositionalIconProps> = (props) => {
    return (
        <div
            ref={props.divRef}
            className={cn("centered-icon", "positional-icon", props.className)}
            onClick={props.onClick}
        >
            <div className="positional-icon-inner">{props.children}</div>
        </div>
    );
};

interface ActionsIconProps {
    onClick: React.MouseEventHandler<HTMLDivElement>;
}

export const ActionsIcon: React.FC<ActionsIconProps> = (props) => {
    return (
        <CenteredIcon className="actions" onClick={props.onClick}>
            <div className="icon hoverEffect fa-sharp fa-solid fa-1x fa-ellipsis-vertical"></div>
        </CenteredIcon>
    );
};

export const SyncSpin: React.FC<{
    classRef?: React.RefObject<Element>;
    children?: React.ReactNode;
    shouldSync?: boolean;
}> = (props) => {
    const { classRef, children, shouldSync } = props;
    const [listenerAdded, setListenerAdded] = React.useState(false);

    const handleAnimationStart = (e: AnimationEvent) => {
        const classRef = props.classRef;
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
    };

    React.useEffect(() => {
        const shouldSyncVal = shouldSync ?? true;
        if (!shouldSyncVal || classRef.current == null) {
            return;
        }
        const elem = classRef.current;
        const svgElem = elem.querySelector("svg");
        if (svgElem == null) {
            return;
        }
        if (!listenerAdded) {
            svgElem.addEventListener("animationstart", handleAnimationStart);
            setListenerAdded(true);
        }
        const animArr = svgElem.getAnimations();
        if (animArr == null || animArr.length == 0) {
            return;
        }
        animArr[0].startTime = 0;
        return () => {
            if (listenerAdded) {
                svgElem.removeEventListener("animationstart", handleAnimationStart);
                setListenerAdded(false);
            }
        };
    });
    return children;
};

interface StatusIndicatorProps {
    /**
     * The level of the status indicator. This will determine the color of the status indicator.
     */
    level: appconst.StatusIndicatorLevel;
    className?: string;
    /**
     * If true, a spinner will be shown around the status indicator.
     */
    runningCommands?: boolean;
}

/**
 * This component is used to show the status of a command. It will show a spinner around the status indicator if there are running commands. It will also delay showing the spinner for a short time to prevent flickering.
 */
export const StatusIndicator: React.FC<StatusIndicatorProps> = (props) => {
    const { level, className, runningCommands } = props;
    const iconRef = React.useRef<HTMLDivElement>();
    const [spinnerVisible, setSpinnerVisible] = React.useState(false);
    const [timeoutState, setTimeoutState] = React.useState<NodeJS.Timeout>(undefined);

    const clearSpinnerTimeout = () => {
        if (timeoutState) {
            clearTimeout(timeoutState);
            setTimeoutState(undefined);
        }
        setSpinnerVisible(false);
    };

    /**
     * This will apply a delay after there is a running command before showing the spinner. This prevents flickering for commands that return quickly.
     */
    React.useEffect(() => {
        if (runningCommands && !timeoutState) {
            console.log("show spinner");
            setTimeoutState(
                setTimeout(() => {
                    setSpinnerVisible(true);
                }, 100)
            );
        } else if (!runningCommands) {
            console.log("clear spinner");
            clearSpinnerTimeout();
        }
        return () => {
            clearSpinnerTimeout();
        };
    }, [runningCommands]);

    let statusIndicator = null;
    if (level != appconst.StatusIndicatorLevel.None || spinnerVisible) {
        let indicatorLevelClass = null;
        switch (level) {
            case appconst.StatusIndicatorLevel.Output:
                indicatorLevelClass = "output";
                break;
            case appconst.StatusIndicatorLevel.Success:
                indicatorLevelClass = "success";
                break;
            case appconst.StatusIndicatorLevel.Error:
                indicatorLevelClass = "error";
                break;
        }

        const spinnerVisibleClass = spinnerVisible ? "spinner-visible" : null;
        statusIndicator = (
            <CenteredIcon
                divRef={iconRef}
                className={cn(className, indicatorLevelClass, spinnerVisibleClass, "status-indicator")}
            >
                <SpinnerIndicator className={spinnerVisible ? "spin" : null} />
            </CenteredIcon>
        );
    }
    return (
        <SyncSpin classRef={iconRef} shouldSync={runningCommands}>
            {statusIndicator}
        </SyncSpin>
    );
};

export const RotateIcon: React.FC<{ className?: string; onClick?: React.MouseEventHandler<SVGSVGElement> }> = (
    props
) => {
    const iconRef = React.useRef<SVGSVGElement>();
    return (
        <SyncSpin classRef={iconRef}>
            <RotateIconSvg ref={iconRef} className={props.className ?? ""} onClick={props.onClick} />
        </SyncSpin>
    );
};
