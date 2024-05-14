// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Block } from "@/app/block/block";
import { atoms } from "@/store/global";

import "./tab.less";

const blockId1 = "44113b0c-1528-4db1-94f0-2cafa1542941";
const blockId2 = "6bd76ccb-76ae-4f29-aa64-35206767e1ac";

const TabContent = ({ tabId }: { tabId: string }) => {
    const tabs = jotai.useAtomValue(atoms.tabsAtom);
    const tabData = tabs.find((tab) => tab.tabid === tabId);
    if (!tabData) {
        return <div className="tabcontent">Tab not found</div>;
    }
    return (
        <div className="tabcontent">
            {tabData.blockIds.map((blockId: string) => {
                return (
                    <div key={blockId} className="block-container">
                        <Block blockId={blockId} />
                    </div>
                );
            })}
        </div>
    );
};

export { TabContent };
