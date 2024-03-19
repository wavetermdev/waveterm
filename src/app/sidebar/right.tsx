// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import dayjs from "dayjs";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { ResizableSidebar, Button } from "@/elements";

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
                className="right-sidebar"
                position="right"
                enableSnap={true}
                parentRef={this.props.parentRef}
            >
                {(toggleCollapse) => (
                    <React.Fragment>
                        <div className="header">
                            <Button className="secondary ghost" onClick={toggleCollapse}>
                                <i className="fa-sharp fa-regular fa-xmark"></i>
                            </Button>
                        </div>
                    </React.Fragment>
                )}
            </ResizableSidebar>
        );
    }
}

export { RightSideBar };
