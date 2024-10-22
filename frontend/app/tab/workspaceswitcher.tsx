// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import ThunderSVG from "../asset/thunder.svg";
import WorskpaceSVG from "../asset/workspace.svg";

import "./workspaceswitcher.less";

const WorkspaceButton = () => {
    return (
        <Button className="workspace-button grey" as="div">
            <span className="icon-left">
                <WorskpaceSVG></WorskpaceSVG>
            </span>
            <span className="divider" />
            <span className="icon-right">
                <ThunderSVG></ThunderSVG>
            </span>
        </Button>
    );
};

export { WorkspaceButton };
