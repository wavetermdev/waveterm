// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { LayoutComponentModel } from "@/app/block/blocktypes";
import { CenteredDiv } from "@/element/quickelems";
import { ContentRenderer, TileLayout } from "@/layout/index";
import { getApi } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { useAtomValue } from "jotai";
import * as React from "react";
import { useMemo } from "react";
import "./tabcontent.less";

const TabContent = React.memo(({ tabId }: { tabId: string }) => {
    const oref = useMemo(() => WOS.makeORef("tab", tabId), [tabId]);
    const loadingAtom = useMemo(() => WOS.getWaveObjectLoadingAtom(oref), [oref]);
    const tabLoading = useAtomValue(loadingAtom);
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(oref), [oref]);
    const tabData = useAtomValue(tabAtom);

    const tileLayoutContents = useMemo(() => {
        const renderBlock: ContentRenderer = (
            blockData: TabLayoutData,
            ready: boolean,
            isMagnified: boolean,
            disablePointerEvents: boolean,
            onMagnifyToggle: () => void,
            onClose: () => void,
            dragHandleRef: React.RefObject<HTMLDivElement>
        ) => {
            if (!blockData.blockId || !ready) {
                return null;
            }
            const layoutModel: LayoutComponentModel = {
                disablePointerEvents,
                onClose,
                onMagnifyToggle,
                dragHandleRef,
                isMagnified,
            };
            return (
                <Block key={blockData.blockId} blockId={blockData.blockId} layoutModel={layoutModel} preview={false} />
            );
        };

        function renderPreview(tabData: TabLayoutData) {
            if (!tabData) return;
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
    }, [tabId]);

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
                tabAtom={tabAtom}
                getCursorPoint={getApi().getCursorPoint}
            />
        </div>
    );
});

export { TabContent };
