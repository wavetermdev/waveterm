// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import * as WOS from "@/store/wos";

import { TileLayout } from "@/faraday/index";
import { getLayoutStateAtomForTab } from "@/faraday/lib/layoutAtom";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { CenteredDiv, CenteredLoadingDiv } from "../element/quickelems";
import "./tab.less";

const TabContent = ({ tabId }: { tabId: string }) => {
    const oref = useMemo(() => WOS.makeORef("tab", tabId), [tabId]);
    const loadingAtom = useMemo(() => WOS.getWaveObjectLoadingAtom<Tab>(oref), [oref]);
    const tabLoading = useAtomValue(loadingAtom);
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(oref), [oref]);
    const layoutStateAtom = useMemo(() => getLayoutStateAtomForTab(tabId, tabAtom), [tabAtom, tabId]);
    const tabData = useAtomValue(tabAtom);

    const renderBlock = useCallback((tabData: TabLayoutData, ready: boolean, onClose: () => void) => {
        // console.log("renderBlock", tabData);
        if (!tabData.blockId || !ready) {
            return null;
        }
        return <Block blockId={tabData.blockId} onClose={onClose} />;
    }, []);

    const onNodeDelete = useCallback((data: TabLayoutData) => {
        console.log("onNodeDelete", data);
        return WOS.DeleteBlock(data.blockId);
    }, []);

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
            <TileLayout
                key={tabId}
                renderContent={renderBlock}
                layoutTreeStateAtom={layoutStateAtom}
                onNodeDelete={onNodeDelete}
            />
        </div>
    );
};

export { TabContent };
