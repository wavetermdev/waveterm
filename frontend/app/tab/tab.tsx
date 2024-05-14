// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Block } from "../block/block.tsx";
import { v4 as uuidv4 } from "uuid";

import "./tab.less";

const TabContent = () => {
    const blockId1 = React.useMemo(() => uuidv4(), []);
    const blockId2 = React.useMemo(() => uuidv4(), []);

    return (
        <div className="tabcontent">
            <div className="block-container block1">
                <Block blockId={blockId1} />
            </div>
            <div className="block-container block2">
                <Block blockId={blockId2} />
            </div>
        </div>
    );
};

export { TabContent };
