// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Block } from "@/app/block/block";
import { atoms } from "@/store/global";

import "./tab.less";

const TabContent = ({ tabId }: { tabId: string }) => {
    const tabs = jotai.useAtomValue(atoms.tabsAtom);
    const tabData = tabs.find((tab) => tab.tabid === tabId);
    if (!tabData) {
        return <div className="tabcontent">Tab not found</div>;
    }
    return (
        <div className="tabcontent">
            {tabData.blockids.map((blockId: string) => {
                return (
                    <div key={blockId} className="block-container">
                        <Block tabId={tabId} blockId={blockId} />
                    </div>
                );
            })}
        </div>
    );
};

export { TabContent };
