// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import cn from "classnames";
import { If } from "tsx-control-statements/components";
import { observer } from "mobx-react";

import "./auxview.less";

interface AuxiliaryCmdViewProps {
    title: string;
    className?: string;
    iconClass?: string;
    titleBarContents?: React.ReactElement[];
    children?: React.ReactNode;
    onClose?: React.MouseEventHandler<HTMLDivElement>;
}

export const AuxiliaryCmdView: React.FC<AuxiliaryCmdViewProps> = observer((props) => {
    const { title, className, iconClass, titleBarContents, children, onClose } = props;

    return (
        <div className={cn("auxview", className)}>
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
            <If condition={children != null}>
                <div className="auxview-content">{children}</div>
            </If>
        </div>
    );
});
