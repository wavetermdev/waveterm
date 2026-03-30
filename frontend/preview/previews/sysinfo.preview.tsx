// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { handleWaveEvent } from "@/app/store/wps";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { SysinfoBlockId } from "../mock/mockwaveenv";
import { useRpcOverride } from "../mock/use-rpc-override";
import {
    DefaultSysinfoHistoryPoints,
    makeMockSysinfoEvent,
    makeMockSysinfoHistory,
    MockSysinfoConnection,
} from "./sysinfo.preview-util";

const PreviewNodeId = "preview-sysinfo-node";

export default function SysinfoPreview() {
    const historyRef = React.useRef(makeMockSysinfoHistory());
    const nodeModel = React.useMemo(
        () => makeMockNodeModel({ nodeId: PreviewNodeId, blockId: SysinfoBlockId, innerRect: { width: "920px", height: "560px" }, numLeafs: 2 }),
        []
    );

    useRpcOverride("EventReadHistoryCommand", async (_client, data) => {
        if (data.event !== "sysinfo" || data.scope !== MockSysinfoConnection) {
            return [];
        }
        const maxItems = data.maxitems ?? historyRef.current.length;
        return historyRef.current.slice(-maxItems);
    });

    React.useEffect(() => {
        let nextStep = historyRef.current.length;
        let nextTs = (historyRef.current[historyRef.current.length - 1]?.data?.ts ?? Date.now()) + 1000;
        const intervalId = window.setInterval(() => {
            const nextEvent = makeMockSysinfoEvent(nextTs, nextStep);
            historyRef.current = [...historyRef.current.slice(-(DefaultSysinfoHistoryPoints - 1)), nextEvent];
            handleWaveEvent(nextEvent);
            nextStep++;
            nextTs += 1000;
        }, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <div className="flex w-full max-w-[980px] flex-col gap-2 px-6 py-6">
            <div className="text-xs text-muted font-mono">full sysinfo block (mock WOS + FE-only WPS events)</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div className="h-[620px]">
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}
