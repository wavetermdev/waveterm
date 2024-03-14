// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import dayjs from "dayjs";
import { If } from "tsx-control-statements/components";
import { compareLoose } from "semver";

import { ReactComponent as AppsIcon } from "@/assets/icons/apps.svg";
import { ReactComponent as WorkspacesIcon } from "@/assets/icons/workspaces.svg";
import { ReactComponent as SettingsIcon } from "@/assets/icons/settings.svg";
import { ReactComponent as WaveLogo } from "@/assets/waveterm-logo.svg";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session } from "@/models";
import { isBlank, openLink } from "@/util/util";
import { ResizableSidebar } from "@/common/elements";
import * as appconst from "@/app/appconst";

import "./right.less";
import { ActionsIcon, CenteredIcon, FrontIcon, StatusIndicator } from "@/common/icons/icons";

dayjs.extend(localizedFormat);

interface RightSideBarProps {
    parentRef: React.RefObject<HTMLElement>;
    clientData: ClientDataType;
}

@mobxReact.observer
class RightSideBar extends React.Component<RightSideBarProps, {}> {
    render() {
        return (
            <ResizableSidebar
                model={GlobalModel.rightSidebarModel}
                className="main-sidebar"
                position="right"
                enableSnap={true}
                parentRef={this.props.parentRef}
            >
                {(toggleCollapse) => <React.Fragment></React.Fragment>}
            </ResizableSidebar>
        );
    }
}

export { RightSideBar };
