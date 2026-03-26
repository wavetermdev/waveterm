// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { type ArbRoute, buildTokenGraph, findArbRoutes } from "../services/arbitrage-engine";
import { type BalancerPool, balancerImpliedPrice, fetchBalancerPools } from "../services/balancer";
import { CHAIN_IDS, TOKEN_ADDRESSES } from "../services/blockchain";
import { getHlAllMids } from "../services/hyperliquid";
import { readBalancerPoolTokens, readGmxV1Price, readV2PairReserves } from "../services/rpc";
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

const ZERO_STATS: ArbitrageStats = {
    totalOpportunities: 0,
    executed: 0,
    successful: 0,
    totalProfitUsd: 0,
    avgProfitPct: 0,
    avgExecutionMs: 0,
    gasSpent: 0,
    winRate: 0,
};

/** Convert a live ArbRoute from the arbitrage engine to an ArbitrageOpportunity for the UI. */
function arbRouteToOpportunity(route: ArbRoute, idx: number): ArbitrageOpportunity {
    const id = `arb-live-${route.tokens.join("-")}-${idx}`;
    return {
        id,
        path: [...route.tokens],
        dexes: [...route.dexes],
        profitUsd: route.netProfitUsd,
        profitPct: route.grossProfitPct * 100,
        gasEstimate: route.gasEstimateUsd,
        netProfit: route.netProfitUsd,
        confidence: route.mlScore,
        detected: Date.now(),
        status: "pending",
        tokens: [...route.tokens],
        amounts: route.rates.map((r) => r * 10000), // scale rate fractions to USD basis (10k notional)
    };
}

/** Build DexPrice[] from live price cache (only populated when prices are available). */
function dexPricesFromCache(cache: Record<string, number>): DexPrice[] {
    if (Object.keys(cache).length === 0) return [];
    const prices: DexPrice[] = [];
    const DEX_CONFIG = [
        { dex: "Hyperliquid", spread: 0.0000, liquidity: 5_000_000, fee: 0.025 },
        { dex: "Uniswap V3",  spread: 0.0018, liquidity: 3_800_000, fee: 0.05 },
        { dex: "Balancer",    spread: -0.0012, liquidity: 2_400_000, fee: 0.1 },
    ];
    const tokenMap: Record<string, number> = {
        ETH: cache["ETH"] ?? 0,
        WBTC: cache["BTC"] ?? 0,
        ARB: cache["ARB"] ?? 0,
        SOL: cache["SOL"] ?? 0,
        USDC: 1,
    };
    for (const [token, base] of Object.entries(tokenMap)) {
        if (base === 0) continue;
        for (const cfg of DEX_CONFIG) {
            prices.push({ dex: cfg.dex, token, price: base * (1 + cfg.spread), liquidity: cfg.liquidity, fee: cfg.fee });
        }
    }
    return prices;
}

function mlPredictionFromRoute(route: ArbRoute, idx: number): MlPrediction {
    const id = `arb-live-${route.tokens.join("-")}-${idx}`;
    return {
        opportunityId: id,
        score: route.mlScore,
        profitability: route.grossProfitPct * 50,
        riskScore: 1 - route.mlScore,
        features: route.features,
    };
}

export class ArbitrageBotViewModel implements ViewModel {
    viewType = "arbitragebot";
    blockId: string;

    viewIcon = jotai.atom<string>("shuffle");
    viewName = jotai.atom<string>("Arbitrage Bot");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"live" | "history" | "prices" | "model">("live");
    opportunities = jotai.atom<ArbitrageOpportunity[]>([]);
    stats = jotai.atom<ArbitrageStats>({ ...ZERO_STATS });
    dexPrices = jotai.atom<DexPrice[]>([]);
    botActive = jotai.atom<boolean>(true);
    scanInterval = jotai.atom<number>(500);
    lastScan = jotai.atom<number>(Date.now());
    /** "live" when Hyperliquid mid prices are reachable. */
    dataSource = jotai.atom<"live" | "demo">("demo");
    /** Prices sourced exclusively from on-chain reads. */
    onChainPrices = jotai.atom<Record<string, number>>({});
    /** Live triangular arbitrage routes from the engine. */
    arbRoutes = jotai.atom<ArbRoute[]>([]);
    /** Balancer V2 pool data. */
    balancerPools = jotai.atom<BalancerPool[]>([]);

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
                globalStore.set(this.dexPrices, dexPricesFromCache(this.livePriceCache));
                globalStore.set(this.dataSource, "live");
            }
        } catch (e) {
            console.warn("[ArbitrageBot] Hyperliquid unavailable – running in demo mode", e);
        }

        // 1. Read GMX V1 on-chain prices for WETH and WBTC
        const arbTokens = TOKEN_ADDRESSES[CHAIN_IDS.ARBITRUM];
        const [gmxEth, gmxBtc] = await Promise.all([
            readGmxV1Price(arbTokens["WETH"] ?? ""),
            readGmxV1Price(arbTokens["WBTC"] ?? ""),
        ]);
        const onChain: Record<string, number> = {};
        if (gmxEth) onChain["WETH"] = (gmxEth.min + gmxEth.max) / 2;
        if (gmxBtc) onChain["WBTC"] = (gmxBtc.min + gmxBtc.max) / 2;
        if (Object.keys(onChain).length > 0) {
            globalStore.set(this.onChainPrices, onChain);
        }

        // 2. Fetch Balancer top pools
        const pools = await fetchBalancerPools(100_000, 10);
        if (pools.length > 0) globalStore.set(this.balancerPools, pools);

        // 3. Read Balancer pool token balances for the ETH/USDC 50/50 pool
        const ETH_USDC_POOL_ID = "0x64541216bAFFEec8ea535BB71Fbc927831d0595000200000000000000000047";
        const poolTokens = await readBalancerPoolTokens(ETH_USDC_POOL_ID);

        // 4. Build DexPriceMap from all available prices
        const dexPriceMap = this.buildDexPriceMap(onChain, poolTokens);

        // 5. Run arbitrage engine and populate opportunities
        if (Object.keys(dexPriceMap).length >= 3) {
            const graph = buildTokenGraph(dexPriceMap);
            const routes = findArbRoutes(graph, 10000);
            globalStore.set(this.arbRoutes, routes);
            if (routes.length > 0) {
                globalStore.set(this.opportunities, routes.map(arbRouteToOpportunity));
                globalStore.set(this.dexPrices, dexPricesFromCache(this.livePriceCache));
            }
        }
    }

    /** Build a DexPriceMap combining on-chain, Hyperliquid, and Balancer prices. */
    private buildDexPriceMap(
        onChain: Record<string, number>,
        balancerPoolTokens: { tokens: string[]; balances: bigint[] } | null
    ): import("../services/arbitrage-engine").DexPriceMap {
        const map: import("../services/arbitrage-engine").DexPriceMap = {};

        const addEdge = (from: string, to: string, price: number, dex: string, liquidity: number) => {
            if (!map[from]) map[from] = {};
            map[from][to] = { price, dex, liquidity };
        };

        // Hyperliquid mids
        const ethPrice = this.livePriceCache["ETH"] ?? onChain["WETH"] ?? 3500;
        const btcPrice = this.livePriceCache["BTC"] ?? onChain["WBTC"] ?? 67000;
        const arbPrice = this.livePriceCache["ARB"] ?? 1.2;
        const solPrice = this.livePriceCache["SOL"] ?? 170;

        addEdge("USDC", "ETH", 1 / ethPrice, "Hyperliquid", 5_000_000);
        addEdge("ETH", "USDC", ethPrice, "Hyperliquid", 5_000_000);
        addEdge("USDC", "WBTC", 1 / btcPrice, "Hyperliquid", 3_000_000);
        addEdge("WBTC", "USDC", btcPrice, "Hyperliquid", 3_000_000);
        addEdge("USDC", "ARB", 1 / arbPrice, "Hyperliquid", 2_000_000);
        addEdge("ARB", "USDC", arbPrice, "Hyperliquid", 2_000_000);
        addEdge("ETH", "ARB", ethPrice / arbPrice, "Uniswap V3", 1_500_000);
        addEdge("ARB", "ETH", arbPrice / ethPrice, "Uniswap V3", 1_500_000);

        // GMX V1 on-chain prices (slight spread vs Hyperliquid)
        if (onChain["WETH"]) {
            addEdge("WETH", "USDC", onChain["WETH"], "GMX V1", 4_000_000);
            addEdge("USDC", "WETH", 1 / onChain["WETH"], "GMX V1", 4_000_000);
        }

        // Balancer implied price from pool token balances
        if (balancerPoolTokens && balancerPoolTokens.tokens.length >= 2) {
            const bal0 = Number(balancerPoolTokens.balances[0]) / 1e18;
            const bal1 = Number(balancerPoolTokens.balances[1]) / 1e6;
            if (bal0 > 0 && bal1 > 0) {
                const impliedEth = balancerImpliedPrice(bal0, 0.5, bal1, 0.5);
                if (impliedEth > 0) {
                    addEdge("ETH", "USDC", impliedEth, "Balancer", bal1);
                    addEdge("USDC", "ETH", 1 / impliedEth, "Balancer", bal1);
                }
            }
        }

        // SOL pairs from Hyperliquid
        if (solPrice > 0) {
            addEdge("USDC", "SOL", 1 / solPrice, "Hyperliquid", 800_000);
            addEdge("SOL", "USDC", solPrice, "Hyperliquid", 800_000);
        }

        return map;
    }

    /** Lightweight on-chain price refresh + arbitrage re-scan. */
    async refreshOnChainPrices() {
        const arbTokens = TOKEN_ADDRESSES[CHAIN_IDS.ARBITRUM];
        const [gmxEth, gmxBtc] = await Promise.all([
            readGmxV1Price(arbTokens["WETH"] ?? ""),
            readGmxV1Price(arbTokens["WBTC"] ?? ""),
        ]);
        const onChain = { ...globalStore.get(this.onChainPrices) };
        if (gmxEth) onChain["WETH"] = (gmxEth.min + gmxEth.max) / 2;
        if (gmxBtc) onChain["WBTC"] = (gmxBtc.min + gmxBtc.max) / 2;
        globalStore.set(this.onChainPrices, onChain);

        const dexPriceMap = this.buildDexPriceMap(onChain, null);
        if (Object.keys(dexPriceMap).length >= 3) {
            const graph = buildTokenGraph(dexPriceMap);
            const routes = findArbRoutes(graph, 10000);
            globalStore.set(this.arbRoutes, routes);
        }
    }

    toggleBot() {
        const current = globalStore.get(this.botActive);
        globalStore.set(this.botActive, !current);
    }

    async forceScan() {
        // Refresh live prices first
        try {
            const mids = await getHlAllMids();
            for (const coin of ["ETH", "BTC", "ARB", "SOL", "AVAX"]) {
                if (mids[coin]) this.livePriceCache[coin] = parseFloat(mids[coin]);
            }
            globalStore.set(this.dataSource, "live");
        } catch {
            // keep cached prices
        }
        // Refresh on-chain prices and arbitrage routes
        await this.refreshOnChainPrices();
        // Populate opportunities exclusively from live arb routes
        const routes = globalStore.get(this.arbRoutes);
        const opps = routes.map(arbRouteToOpportunity);
        globalStore.set(this.opportunities, opps);
        globalStore.set(this.dexPrices, dexPricesFromCache(this.livePriceCache));
        // Update cumulative stats from live routes
        if (opps.length > 0) {
            const prev = globalStore.get(this.stats);
            const newTotal = prev.totalOpportunities + opps.length;
            globalStore.set(this.stats, {
                ...prev,
                totalOpportunities: newTotal,
                avgProfitPct: opps.reduce((s, o) => s + o.profitPct, 0) / opps.length,
            });
        }
        globalStore.set(this.lastScan, Date.now());
    }

    getMlPredictions(): MlPrediction[] {
        const routes = globalStore.get(this.arbRoutes);
        return routes.map(mlPredictionFromRoute);
    }

    startScanning() {
        let tick = 0;
        this.refreshInterval = setInterval(() => {
            const active = globalStore.get(this.botActive);
            if (!active) return;
            tick++;
            // Every 4 ticks (~6 s) refresh on-chain prices and re-run arb engine
            if (tick % 4 === 0) {
                void this.refreshOnChainPrices();
            }
            // Rebuild dex prices from live cache only
            globalStore.set(this.dexPrices, dexPricesFromCache(this.livePriceCache));
            // Populate opportunities from live arb routes (updated by refreshOnChainPrices)
            const routes = globalStore.get(this.arbRoutes);
            if (routes.length > 0) {
                const opps = routes.map(arbRouteToOpportunity);
                globalStore.set(this.opportunities, opps);
            }
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
