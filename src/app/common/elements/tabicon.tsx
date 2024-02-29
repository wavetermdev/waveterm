// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { isBlank } from "@/util/util";
import cn from "classnames";

class TabIcon extends React.Component<{ icon: string; color: string }> {
    render() {
        let { icon, color } = this.props;
        let iconClass = "";
        if (icon === "default" || icon === "square") {
            iconClass = "fa-solid fa-square fa-fw";
        } else {
            iconClass = `fa-sharp fa-solid fa-${icon} fa-fw`;
        }
        if (isBlank(color) || color === "default") {
            color = "green";
        }
        return (
            <div className={cn("icon", "color-" + color)}>
                <i className={iconClass} />
            </div>
        );
    }
}

export { TabIcon };
