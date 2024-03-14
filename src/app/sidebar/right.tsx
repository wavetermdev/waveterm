// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import dayjs from "dayjs";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { ResizableSidebar } from "@/common/elements";

import "./right.less";

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
