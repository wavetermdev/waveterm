// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import cn from "classnames";
import { Choose, If, Otherwise, When } from "tsx-control-statements/components";
import { observer } from "mobx-react";

import "./auxview.less";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

interface AuxiliaryCmdViewProps {
    title: string;
    className?: string;
    iconClass?: string;
    titleBarContents?: React.ReactElement[];
    children?: React.ReactNode;
    onClose?: React.MouseEventHandler<HTMLDivElement>;
    onScrollbarInitialized?: () => void;
    scrollable?: boolean;
}

export const AuxiliaryCmdView: React.FC<AuxiliaryCmdViewProps> = observer((props) => {
    const { title, className, iconClass, titleBarContents, children, onClose, onScrollbarInitialized } = props;

    return (
        <div className={cn("auxview", className)}>
            <If condition={title || onClose || titleBarContents || iconClass}>
                <div className="auxview-titlebar">
                    <If condition={iconClass != null}>
                        <div className="title-icon">
                            <i className={iconClass} />
                        </div>
                    </If>
                    <div className="title-string">{title}</div>

                    <If condition={titleBarContents != null}>{titleBarContents}</If>

                    <div className="flex-spacer"></div>

                    <If condition={onClose != null}>
                        <div className="close-button" title="Close (ESC)" onClick={onClose}>
                            <i className="fa-sharp fa-solid fa-xmark-large" />
                        </div>
                    </If>
                </div>
            </If>
            <If condition={children != null}>
                <Choose>
                    <When condition={props.scrollable}>
                        <OverlayScrollbarsComponent
                            className="auxview-content"
                            options={{ scrollbars: { autoHide: "leave" } }}
                            defer={true}
                            events={{ initialized: onScrollbarInitialized }}
                        >
                            {children}
                        </OverlayScrollbarsComponent>
                    </When>
                    <Otherwise>
                        <div className="auxview-content">{children}</div>
                    </Otherwise>
                </Choose>
            </If>
        </div>
    );
});
