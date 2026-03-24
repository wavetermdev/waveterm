// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { FlashLoan } from "./flashloan";

export type PortfolioAsset = {
    symbol: string;
    icon: string;
    currentPct: number;
    targetPct: number;
    value: number;
    price: number;
};

export type FlashLoanStrategy = {
    id: string;
    name: string;
    description: string;
    protocol: string;
    loanToken: string;
    loanAmount: number;
    expectedProfitUsd: number;
    gasEstimate: number;
    netProfit: number;
    apy: number;
    riskLevel: "low" | "medium" | "high";
    status: "ready" | "simulating" | "executing" | "completed" | "failed";
    steps: string[];
    txHash?: string;
};

export type RebalanceTrade = {
    symbol: string;
    action: "buy" | "sell";
    amount: number;
    amountUsd: number;
    protocol: string;
};

export type SimulationResult = {
    startBalance: number;
    endBalance: number;
    profit: number;
    gasUsed: number;
    executionTime: number;
    success: boolean;
    trace: string[];
};

function generatePortfolio(): PortfolioAsset[] {
    return [
        { symbol: "ETH", icon: "💎", currentPct: 35, targetPct: 40, value: 17600, price: 3520 },
        { symbol: "BTC", icon: "₿", currentPct: 28, targetPct: 30, value: 13448, price: 67450 },
        { symbol: "USDC", icon: "💵", currentPct: 22, targetPct: 15, value: 10560, price: 1 },
        { symbol: "ARB", icon: "🔵", currentPct: 8, targetPct: 10, value: 3840, price: 1.24 },
        { symbol: "LINK", icon: "🔗", currentPct: 7, targetPct: 5, value: 3360, price: 14.2 },
    ];
}

function generateStrategies(): FlashLoanStrategy[] {
    return [
        {
            id: "strat-1",
            name: "Aave Flash + Uni Rebalance",
            description: "Flash borrow USDC from Aave, rebalance via Uniswap V3, repay in single tx",
            protocol: "Aave V3",
            loanToken: "USDC",
            loanAmount: 50000,
            expectedProfitUsd: 342.5,
            gasEstimate: 18.7,
            netProfit: 323.8,
            apy: 94.2,
            riskLevel: "low",
            status: "ready",
            steps: [
                "Flash borrow 50,000 USDC from Aave V3",
                "Swap USDC → ETH via Uniswap V3 (24% target delta)",
                "Swap excess USDC → ARB via Camelot",
                "Reduce LINK position via SushiSwap",
                "Repay Aave flash loan + 0.09% fee",
                "Pocket rebalance fee proceeds",
            ],
        },
        {
            id: "strat-2",
            name: "Balancer Flash + Multi-hop",
            description: "Multi-hop rebalance using Balancer flash loans across 3 DEXes",
            protocol: "Balancer V2",
            loanToken: "WETH",
            loanAmount: 5,
            expectedProfitUsd: 189.3,
            gasEstimate: 24.1,
            netProfit: 165.2,
            apy: 52.4,
            riskLevel: "medium",
            status: "ready",
            steps: [
                "Flash borrow 5 WETH from Balancer",
                "Deposit WETH into Curve STETH pool",
                "Swap stETH → USDC via Curve",
                "Distribute USDC across target allocations",
                "Repay Balancer flash loan",
            ],
        },
        {
            id: "strat-3",
            name: "Leveraged Rebalance",
            description: "Use leverage to amplify rebalance returns via perpetual positions",
            protocol: "Aave V3 + GMX",
            loanToken: "USDC",
            loanAmount: 100000,
            expectedProfitUsd: 812.0,
            gasEstimate: 42.5,
            netProfit: 769.5,
            apy: 187.3,
            riskLevel: "high",
            status: "simulating",
            steps: [
                "Flash borrow 100,000 USDC from Aave V3",
                "Open leveraged long ETH on GMX",
                "Hedge with short on Hyperliquid",
                "Close positions after rebalance",
                "Repay flash loan + collect delta",
            ],
        },
    ];
}

function generateRebalanceTrades(portfolio: PortfolioAsset[]): RebalanceTrade[] {
    return portfolio
        .filter((a) => Math.abs(a.currentPct - a.targetPct) > 0.5)
        .map((a) => {
            const diff = a.targetPct - a.currentPct;
            const tradeDeltaUsd = (Math.abs(diff) / 100) * (a.value / (a.currentPct / 100));
            return {
                symbol: a.symbol,
                action: diff > 0 ? "buy" : "sell",
                amount: tradeDeltaUsd / a.price,
                amountUsd: tradeDeltaUsd,
                protocol: diff > 0 ? "Uniswap V3" : "Camelot",
            };
        });
}

function simulateExecution(): SimulationResult {
    const success = Math.random() > 0.05;
    return {
        startBalance: 48800,
        endBalance: success ? 49123.8 : 48800,
        profit: success ? 323.8 : 0,
        gasUsed: 18.7,
        executionTime: 187 + Math.random() * 50,
        success,
        trace: [
            "[0ms] Initiating flash loan: 50,000 USDC from Aave",
            "[12ms] Flash loan received",
            "[45ms] Executing Uniswap V3 swap: USDC → ETH",
            "[89ms] Swap completed: received 3.41 ETH",
            "[102ms] Executing Camelot swap: USDC → ARB",
            "[134ms] Swap completed: received 1,612 ARB",
            "[156ms] Repaying Aave flash loan: 50,045 USDC",
            "[187ms] Transaction confirmed. Profit: $323.8",
        ],
    };
}

export class FlashLoanViewModel implements ViewModel {
    viewType = "flashloan";
    blockId: string;

    viewIcon = jotai.atom<string>("bolt");
    viewName = jotai.atom<string>("Flash Loan Rebalancer");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"portfolio" | "strategies" | "simulate" | "history">("portfolio");
    portfolio = jotai.atom<PortfolioAsset[]>(generatePortfolio());
    strategies = jotai.atom<FlashLoanStrategy[]>(generateStrategies());
    selectedStrategyId = jotai.atom<string>("strat-1");
    simulationResult = jotai.atom<SimulationResult | null>(null) as jotai.PrimitiveAtom<SimulationResult | null>;
    isSimulating = jotai.atom<boolean>(false);
    totalPortfolioValue = jotai.atom<number>(48808);

    rebalanceTrades: jotai.Atom<RebalanceTrade[]>;
    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;

        this.rebalanceTrades = jotai.atom((get) => {
            const portfolio = get(this.portfolio);
            return generateRebalanceTrades(portfolio);
        });

        this.viewText = jotai.atom((get) => {
            const total = get(this.totalPortfolioValue);
            const trades = get(this.rebalanceTrades);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `Portfolio: $${total.toLocaleString()}`,
                    noGrow: true,
                },
                trades.length > 0
                    ? ({
                          elemtype: "text",
                          text: `${trades.length} trades pending`,
                          className: "widget-rebalance-pending",
                          noGrow: true,
                      } as HeaderElem)
                    : ({
                          elemtype: "text",
                          text: "✓ Balanced",
                          className: "widget-rebalance-ok",
                          noGrow: true,
                      } as HeaderElem),
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh portfolio",
                    click: () => this.refreshPortfolio(),
                },
            ];
            return elems;
        });

        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return FlashLoan as ViewComponent;
    }

    refreshPortfolio() {
        const current = globalStore.get(this.portfolio);
        const updated = current.map((a) => ({
            ...a,
            price: a.price * (1 + (Math.random() - 0.5) * 0.02),
            value: a.value * (1 + (Math.random() - 0.5) * 0.02),
        }));
        globalStore.set(this.portfolio, updated);
        const total = updated.reduce((s, a) => s + a.value, 0);
        globalStore.set(this.totalPortfolioValue, total);
    }

    async runSimulation() {
        globalStore.set(this.isSimulating, true);
        globalStore.set(this.simulationResult, null);
        await new Promise((r) => setTimeout(r, 1800));
        const result = simulateExecution();
        globalStore.set(this.simulationResult, result);
        globalStore.set(this.isSimulating, false);
    }

    startRefresh() {
        this.refreshInterval = setInterval(() => {
            this.refreshPortfolio();
        }, 8000);
    }

    dispose() {
        if (this.refreshInterval != null) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    giveFocus(): boolean {
        return true;
    }
}
