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

function randomBetween(a: number, b: number): number {
    return a + Math.random() * (b - a);
}

function generateOpportunities(): ArbitrageOpportunity[] {
    return TOKEN_PAIRS.map((path, i) => {
        const profit = randomBetween(5, 280);
        const gas = randomBetween(8, 45);
        const statuses: ArbitrageOpportunity["status"][] = [
            "pending",
            "executing",
            "completed",
            "completed",
            "expired",
        ];
        return {
            id: `arb-${Date.now()}-${i}`,
            path,
            dexes: [DEX_NAMES[i % DEX_NAMES.length], DEX_NAMES[(i + 1) % DEX_NAMES.length]],
            profitUsd: profit,
            profitPct: randomBetween(0.08, 1.8),
            gasEstimate: gas,
            netProfit: profit - gas,
            confidence: randomBetween(0.6, 0.97),
            detected: Date.now() - i * 3000,
            status: statuses[i],
            tokens: path,
            amounts: path.map(() => randomBetween(1000, 50000)),
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
        DEX_NAMES.slice(0, 3).forEach((dex) => {
            prices.push({
                dex,
                token,
                price: price * (1 + randomBetween(-0.003, 0.003)),
                liquidity: randomBetween(500000, 5000000),
                fee: [0.05, 0.3, 0.25][Math.floor(Math.random() * 3)],
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
            price_spread: randomBetween(0.001, 0.02),
            liquidity_ratio: randomBetween(0.3, 1.0),
            gas_price_gwei: randomBetween(0.01, 0.5),
            time_window_ms: randomBetween(50, 500),
            historical_success: randomBetween(0.7, 0.98),
            volatility: randomBetween(0.01, 0.15),
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
        this.refreshInterval = setInterval(() => {
            const active = globalStore.get(this.botActive);
            if (!active) return;
            // Refresh DEX prices (with live base prices when available) and update opportunity status
            globalStore.set(this.dexPrices, generateDexPrices(this.livePriceCache));
            const prev = globalStore.get(this.opportunities);
            const updated = prev.map((opp) => {
                if (opp.status === "pending" && Math.random() > 0.8) {
                    return { ...opp, status: "executing" as const };
                }
                if (opp.status === "executing" && Math.random() > 0.6) {
                    return { ...opp, status: (Math.random() > 0.05 ? "completed" : "failed") as ArbitrageOpportunity["status"] };
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
