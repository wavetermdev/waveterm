// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { LayoutComponentModel } from "@/app/block/blocktypes";
import { getApi } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import * as React from "react";

import { CenteredDiv } from "@/element/quickelems";
import { ContentRenderer } from "@/layout/lib/model";
import { TileLayout } from "frontend/layout/index";
import { getLayoutStateAtomForTab } from "frontend/layout/lib/layoutAtom";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import "./tabcontent.less";

const TabContent = React.memo(({ tabId }: { tabId: string }) => {
    const oref = useMemo(() => WOS.makeORef("tab", tabId), [tabId]);
    const loadingAtom = useMemo(() => WOS.getWaveObjectLoadingAtom(oref), [oref]);
    const tabLoading = useAtomValue(loadingAtom);
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(oref), [oref]);
    const layoutStateAtom = useMemo(() => getLayoutStateAtomForTab(tabId, tabAtom), [tabAtom, tabId]);
    const tabData = useAtomValue(tabAtom);

    const tileLayoutContents = useMemo(() => {
        const renderBlock: ContentRenderer<TabLayoutData> = (
            tabData: TabLayoutData,
            ready: boolean,
            disablePointerEvents: boolean,
            onMagnifyToggle: () => void,
            onClose: () => void,
            dragHandleRef: React.RefObject<HTMLDivElement>
        ) => {
            if (!tabData.blockId || !ready) {
                return null;
            }
            const layoutModel: LayoutComponentModel = {
                disablePointerEvents,
                onClose,
                onMagnifyToggle,
                dragHandleRef,
            };
            return <Block key={tabData.blockId} blockId={tabData.blockId} layoutModel={layoutModel} preview={false} />;
        };

        function renderPreview(tabData: TabLayoutData) {
            return <Block key={tabData.blockId} blockId={tabData.blockId} layoutModel={null} preview={true} />;
        }

        function onNodeDelete(data: TabLayoutData) {
            return services.ObjectService.DeleteBlock(data.blockId);
        }

        return {
            renderContent: renderBlock,
            renderPreview: renderPreview,
            tabId: tabId,
            onNodeDelete: onNodeDelete,
        };
    }, []);

    if (tabLoading) {
        return (
            <div className="tabcontent">
                <CenteredDiv>Tab Loading</CenteredDiv>
            </div>
        );
    }

    if (!tabData) {
        return (
            <div className="tabcontent">
                <CenteredDiv>Tab Not Found</CenteredDiv>
            </div>
        );
    }

    if (tabData?.blockids?.length == 0) {
        return <div className="tabcontent tabcontent-empty"></div>;
    }

    return (
        <div className="tabcontent">
            <TileLayout
                key={tabId}
                contents={tileLayoutContents}
                layoutTreeStateAtom={layoutStateAtom}
                getCursorPoint={getApi().getCursorPoint}
            />
        </div>
    );
});

export { TabContent };