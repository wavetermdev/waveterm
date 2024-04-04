// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import cn from "classnames";
import { If } from "tsx-control-statements/components";

import "./auxview.less";

export class AuxiliaryCmdView extends React.Component<
    {
        title: string;
        className?: string;
        iconClass?: string;
        titleBarContents?: React.ReactElement[];
        children?: React.ReactNode;
        onClose: React.MouseEventHandler<HTMLDivElement>;
    },
    {}
> {
    render() {
        const { title, className, iconClass, titleBarContents, children, onClose } = this.props;

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
                    <div className="close-button" title="Close (ESC)" onClick={onClose}>
                        <i className="fa-sharp fa-solid fa-xmark-large" />
                    </div>
                </div>
                <If condition={children != null}>
                    <div className="auxview-content">{children}</div>
                </If>
            </div>
        );
    }
}
