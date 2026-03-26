// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { getHlAllMids, toCoin } from "../services/hyperliquid";
import { ArbitrageBot } from "./arbitragebot";

export type ArbitrageOpportunity = {
    id: string;
    path: string[];
    dexes: string[];
    profitUsd: number;
    profitPct: number;
    gasEstimate: number;
    netProfit: number;
    confidence: number;
    detected: number;
    status: "pending" | "executing" | "completed" | "failed" | "expired";
    tokens: string[];
    amounts: number[];
};

export type ArbitrageStats = {
    totalOpportunities: number;
    executed: number;
    successful: number;
    totalProfitUsd: number;
    avgProfitPct: number;
    avgExecutionMs: number;
    gasSpent: number;
    winRate: number;
};

export type DexPrice = {
    dex: string;
    token: string;
    price: number;
    liquidity: number;
    fee: number;
};

export type MlPrediction = {
    opportunityId: string;
    score: number;
    profitability: number;
    riskScore: number;
    features: Record<string, number>;
};

const DEX_NAMES = ["Uniswap V3", "SushiSwap", "Camelot", "GMX", "Balancer"];
const TOKEN_PAIRS = [
    ["USDC", "ETH", "ARB"],
    ["WBTC", "USDC", "ARB"],
    ["ETH", "USDT", "GMX"],
    ["ARB", "ETH", "USDC"],
    ["MAGIC", "ETH", "USDC"],
];

// Per-pair fixed opportunity data (index-stable, deterministic)
const OPPORTUNITY_DATA: Array<{ profit: number; profitPct: number; gas: number; confidence: number; amounts: number[] }> = [
    { profit: 142.5, profitPct: 0.62, gas: 18.3, confidence: 0.89, amounts: [25000, 7.1, 1250] },
    { profit: 87.2,  profitPct: 0.38, gas: 22.1, confidence: 0.74, amounts: [0.38, 25000, 1820] },
    { profit: 213.8, profitPct: 0.94, gas: 31.4, confidence: 0.82, amounts: [12000, 3.4, 4200] },
    { profit: 56.1,  profitPct: 0.24, gas: 14.7, confidence: 0.91, amounts: [18000, 5.1, 14500] },
    { profit: 175.3, profitPct: 0.77, gas: 26.8, confidence: 0.68, amounts: [3400, 0.97, 2800] },
];

// Fixed DEX liquidity and spread offsets (dex index → spread fraction)
const DEX_SPREAD: number[] = [0.0018, -0.0012, 0.0025];
const DEX_LIQUIDITY: number[] = [2400000, 3800000, 1600000];
const DEX_FEES: number[] = [0.05, 0.3, 0.25];

function generateOpportunities(): ArbitrageOpportunity[] {
    return TOKEN_PAIRS.map((path, i) => {
        const d = OPPORTUNITY_DATA[i];
        const statuses: ArbitrageOpportunity["status"][] = [
            "pending",
            "executing",
            "completed",
            "completed",
            "expired",
        ];
        return {
            id: `arb-init-${i}`,
            path,
            dexes: [DEX_NAMES[i % DEX_NAMES.length], DEX_NAMES[(i + 1) % DEX_NAMES.length]],
            profitUsd: d.profit,
            profitPct: d.profitPct,
            gasEstimate: d.gas,
            netProfit: d.profit - d.gas,
            confidence: d.confidence,
            detected: Date.now() - i * 3000,
            status: statuses[i],
            tokens: path,
            amounts: d.amounts,
        };
    });
}

function generateStats(): ArbitrageStats {
    return {
        totalOpportunities: 847,
        executed: 312,
        successful: 289,
        totalProfitUsd: 14823.5,
        avgProfitPct: 0.34,
        avgExecutionMs: 187,
        gasSpent: 2341.2,
        winRate: 92.6,
    };
}

function generateDexPrices(livePrices?: Record<string, number>): DexPrice[] {
    const prices: DexPrice[] = [];
    // Use live prices when available, otherwise fall back to mock base prices
    const base: Record<string, number> = {
        ETH: livePrices?.ETH ?? 3520,
        USDC: 1,
        ARB: livePrices?.ARB ?? 1.24,
        WBTC: livePrices?.BTC ?? 67450,
    };
    Object.entries(base).forEach(([token, price]) => {
        DEX_NAMES.slice(0, 3).forEach((dex, dexIdx) => {
            prices.push({
                dex,
                token,
                price: price * (1 + DEX_SPREAD[dexIdx]),
                liquidity: DEX_LIQUIDITY[dexIdx],
                fee: DEX_FEES[dexIdx],
            });
        });
    });
    return prices;
}

function generateMlPrediction(opp: ArbitrageOpportunity): MlPrediction {
    return {
        opportunityId: opp.id,
        score: opp.confidence,
        profitability: opp.profitPct / 2,
        riskScore: 1 - opp.confidence,
        features: {
            price_spread: 0.0072,
            liquidity_ratio: 0.68,
            gas_price_gwei: 0.14,
            time_window_ms: 210,
            historical_success: 0.87,
            volatility: 0.048,
        },
    };
}

export class ArbitrageBotViewModel implements ViewModel {
    viewType = "arbitragebot";
    blockId: string;

    viewIcon = jotai.atom<string>("shuffle");
    viewName = jotai.atom<string>("Arbitrage Bot");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"live" | "history" | "prices" | "model">("live");
    opportunities = jotai.atom<ArbitrageOpportunity[]>(generateOpportunities());
    stats = jotai.atom<ArbitrageStats>(generateStats());
    dexPrices = jotai.atom<DexPrice[]>(generateDexPrices());
    botActive = jotai.atom<boolean>(true);
    scanInterval = jotai.atom<number>(500);
    lastScan = jotai.atom<number>(Date.now());
    /** "live" when Hyperliquid mid prices are reachable. */
    dataSource = jotai.atom<"live" | "demo">("demo");

    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;
    /** Last known live prices keyed by coin (e.g. "ETH", "BTC", "ARB"). */
    private livePriceCache: Record<string, number> = {};

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const active = get(this.botActive);
            const stats = get(this.stats);
            const src = get(this.dataSource);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `Profit: $${stats.totalProfitUsd.toFixed(0)}`,
                    className: "widget-pnl-positive",
                    noGrow: true,
                },
                {
                    elemtype: "text",
                    text: src === "live" ? "● LIVE" : "○ DEMO",
                    className: src === "live" ? "widget-source-live" : "widget-source-demo",
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: active ? "pause" : "play",
                    title: active ? "Pause scanning" : "Start scanning",
                    click: () => this.toggleBot(),
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Force scan",
                    click: () => this.forceScan(),
                },
            ];
            return elems;
        });
        void this.initLivePrices();
        this.startScanning();
    }

    get viewComponent(): ViewComponent {
        return ArbitrageBot as ViewComponent;
    }

    /** Fetch real mid prices from Hyperliquid to seed DEX price displays. */
    async initLivePrices() {
        try {
            const mids = await getHlAllMids();
            const targets = ["ETH", "BTC", "ARB", "SOL", "AVAX"];
            let found = 0;
            for (const coin of targets) {
                const raw = mids[coin];
                if (raw) {
                    this.livePriceCache[coin] = parseFloat(raw);
                    found++;
                }
            }
            if (found > 0) {
                globalStore.set(this.dexPrices, generateDexPrices(this.livePriceCache));
                globalStore.set(this.dataSource, "live");
            }
        } catch (e) {
            console.warn("[ArbitrageBot] Hyperliquid unavailable – running in demo mode", e);
        }
    }

    toggleBot() {
        const current = globalStore.get(this.botActive);
        globalStore.set(this.botActive, !current);
    }

    async forceScan() {
        // Refresh live prices first, then regenerate opportunities
        try {
            const mids = await getHlAllMids();
            for (const coin of ["ETH", "BTC", "ARB", "SOL", "AVAX"]) {
                if (mids[coin]) this.livePriceCache[coin] = parseFloat(mids[coin]);
            }
            globalStore.set(this.dataSource, "live");
        } catch {
            // keep cached prices
        }
        globalStore.set(this.opportunities, generateOpportunities());
        globalStore.set(this.dexPrices, generateDexPrices(this.livePriceCache));
        globalStore.set(this.lastScan, Date.now());
    }

    getMlPredictions(): MlPrediction[] {
        const opps = globalStore.get(this.opportunities);
        return opps.map(generateMlPrediction);
    }

    startScanning() {
        // Deterministic tick counter drives status transitions: pending→executing (tick 3), executing→completed (tick 6)
        let tick = 0;
        this.refreshInterval = setInterval(() => {
            const active = globalStore.get(this.botActive);
            if (!active) return;
            tick++;
            // Refresh DEX prices (with live base prices when available) and update opportunity status
            globalStore.set(this.dexPrices, generateDexPrices(this.livePriceCache));
            const prev = globalStore.get(this.opportunities);
            const updated = prev.map((opp) => {
                if (opp.status === "pending" && tick % 3 === 0) {
                    return { ...opp, status: "executing" as const };
                }
                if (opp.status === "executing" && tick % 3 === 2) {
                    return { ...opp, status: "completed" as ArbitrageOpportunity["status"] };
                }
                return opp;
            });
            globalStore.set(this.opportunities, updated);
            globalStore.set(this.lastScan, Date.now());
        }, 1500);
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
