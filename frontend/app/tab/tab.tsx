// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import * as WOS from "@/store/wos";

import { CenteredDiv, CenteredLoadingDiv } from "../element/quickelems";
import "./tab.less";

const TabContent = ({ tabId }: { tabId: string }) => {
    const [tabData, tabLoading] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    if (tabLoading) {
        return <CenteredLoadingDiv />;
    }
    if (!tabData) {
        return (
            <div className="tabcontent">
                <CenteredDiv>Tab Not Found</CenteredDiv>
            </div>
        );
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
