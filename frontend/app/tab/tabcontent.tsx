// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block, BlockFrame } from "@/app/block/block";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";

import { CenteredDiv, CenteredLoadingDiv } from "@/element/quickelems";
import { TileLayout } from "@/faraday/index";
import { getLayoutStateAtomForTab } from "@/faraday/lib/layoutAtom";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import "./tabcontent.less";

const TabContent = ({ tabId }: { tabId: string }) => {
    const oref = useMemo(() => WOS.makeORef("tab", tabId), [tabId]);
    const loadingAtom = useMemo(() => WOS.getWaveObjectLoadingAtom(oref), [oref]);
    const tabLoading = useAtomValue(loadingAtom);
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(oref), [oref]);
    const layoutStateAtom = useMemo(() => getLayoutStateAtomForTab(tabId, tabAtom), [tabAtom, tabId]);
    const tabData = useAtomValue(tabAtom);

    const renderBlock = useCallback(
        (
            tabData: TabLayoutData,
            ready: boolean,
            onClose: () => void,
            dragHandleRef: React.RefObject<HTMLDivElement>
        ) => {
            // console.log("renderBlock", tabData);
            if (!tabData.blockId || !ready) {
                return null;
            }
            return <Block blockId={tabData.blockId} onClose={onClose} dragHandleRef={dragHandleRef} />;
        },
        []
    );

    const renderPreview = useCallback((tabData: TabLayoutData) => {
        console.log("renderPreview", tabData);
        return <BlockFrame blockId={tabData.blockId} preview={true} />;
    }, []);

    const onNodeDelete = useCallback((data: TabLayoutData) => {
        console.log("onNodeDelete", data);
        return services.ObjectService.DeleteBlock(data.blockId);
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
                renderPreview={renderPreview}
                layoutTreeStateAtom={layoutStateAtom}
                onNodeDelete={onNodeDelete}
            />
        </div>
    );
};

export { TabContent };
