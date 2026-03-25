// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import {
    AmmLiquidityBlockId,
    ArbitrageBotBlockId,
    DeFiLendingBlockId,
    FlashLoanBlockId,
    TradingAlgoBotBlockId,
} from "../mock/mockwaveenv";

type WidgetEntry = {
    label: string;
    blockId: string;
    width: string;
    height: string;
};

const WIDGETS: WidgetEntry[] = [
    {
        label: "Trading Algobot — Hyperliquid + ONNX/Joblib ML",
        blockId: TradingAlgoBotBlockId,
        width: "1100px",
        height: "640px",
    },
    {
        label: "Arbitrage Bot — Triangular Arb on Arbitrum + ML",
        blockId: ArbitrageBotBlockId,
        width: "1100px",
        height: "580px",
    },
    {
        label: "DeFi Lending — Supply / Borrow / Collateral Swap Repay + ML",
        blockId: DeFiLendingBlockId,
        width: "1100px",
        height: "640px",
    },
    {
        label: "Flash Loan — Arbitrage Portfolio Rebalancer",
        blockId: FlashLoanBlockId,
        width: "1100px",
        height: "620px",
    },
    {
        label: "AMM Liquidity Pools — Uniswap V3 / Camelot / Curve / Balancer",
        blockId: AmmLiquidityBlockId,
        width: "1100px",
        height: "640px",
    },
];

function WidgetPreviewBlock({ entry }: { entry: WidgetEntry }) {
    const nodeModel = React.useMemo(
        () =>
            makeMockNodeModel({
                nodeId: `preview-${entry.blockId}-node`,
                blockId: entry.blockId,
                innerRect: { width: entry.width, height: entry.height },
            }),
        [entry.blockId]
    );

    return (
        <div className="flex w-full max-w-[1160px] flex-col gap-2 px-6">
            <div className="text-xs text-muted font-mono">{entry.label}</div>
            <div className="rounded-md border border-border bg-panel p-4">
                <div style={{ height: entry.height, width: "100%" }}>
                    <Block preview={false} nodeModel={nodeModel} />
                </div>
            </div>
        </div>
    );
}

export default function DeFiWidgetsPreview() {
    return (
        <div className="flex flex-col gap-12 py-8 items-center w-full">
            <div className="text-sm text-foreground font-mono font-semibold">
                DeFi / Financial Widgets — Preview
            </div>
            {WIDGETS.map((entry) => (
                <WidgetPreviewBlock key={entry.blockId} entry={entry} />
            ))}
        </div>
    );
}
