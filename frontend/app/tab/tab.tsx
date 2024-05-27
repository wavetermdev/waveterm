// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Block } from "@/app/block/block";
import { atoms } from "@/store/global";
import * as WOS from "@/store/wos";

import "./tab.less";
import { CenteredLoadingDiv } from "../element/quickelems";

const TabContent = ({ tabId }: { tabId: string }) => {
    const [tabData, tabLoading] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    if (tabLoading) {
        return <CenteredLoadingDiv />;
    }
    if (!tabData) {
        return <div className="tabcontent">Tab not found</div>;
    }
    return (
        <div className="tabcontent">
            {tabData.blockids.map((blockId: string) => {
                return (
                    <div key={blockId} className="block-container">
                        <Block key={blockId} tabId={tabId} blockId={blockId} />
                    </div>
                );
            })}
        </div>
    );
};

export { TabContent };
