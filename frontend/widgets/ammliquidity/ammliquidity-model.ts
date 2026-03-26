// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { fetchTokenPrices } from "../services/coingecko";
import { fetchBalancerPools, balancerImpliedPrice, BalancerPool as BalancerSubgraphPool } from "../services/balancer";
import { AmmLiquidity } from "./ammliquidity";

export type LiquidityPool = {
    id: string;
    token0: string;
    token1: string;
    icon0: string;
    icon1: string;
    protocol: string;
    fee: number; // percent e.g. 0.05, 0.3, 1.0
    tvl: number; // USD
    volume24h: number; // USD
    apy: number; // percent
    feesEarned24h: number;
    price: number; // token1 per token0
    tickLower?: number;
    tickUpper?: number;
    reserves0: number;
    reserves1: number;
};

export type UserLpPosition = {
    poolId: string;
    liquidityTokens: number;
    token0Amount: number;
    token1Amount: number;
    valueUsd: number;
    feesEarned: number;
    impermanentLoss: number;
    entryPrice: number;
};

export type PoolStats = {
    totalTvl: number;
    totalFeesEarned: number;
    totalIL: number;
    avgApy: number;
};

export type PriceImpact = {
    inputToken: string;
    outputToken: string;
    inputAmount: number;
    outputAmount: number;
    priceImpact: number;
    fee: number;
    effectivePrice: number;
};

const TOKEN_ICONS: Record<string, string> = {
    ETH: "💎", WETH: "💎", WBTC: "₿", BTC: "₿",
    USDC: "💵", USDT: "💵", DAI: "🟡",
    ARB: "🔵", GMX: "🎯", BAL: "⚖️", LINK: "🔗",
    MATIC: "🟣", SOL: "◎", AVAX: "🔺",
};

function tokenIcon(symbol: string): string {
    return TOKEN_ICONS[symbol?.toUpperCase() ?? ""] ?? "🔷";
}

/** Convert a BalancerPool subgraph record into the widget's LiquidityPool shape. */
function balancerToLiquidityPool(bp: BalancerSubgraphPool): LiquidityPool {
    const t0 = bp.tokens[0];
    const t1 = bp.tokens[1] ?? bp.tokens[0];

    // Compute implied price from Balancer weighted pool formula when weights are available
    let price = 0;
    if (t0 && t1) {
        if (t0.weight != null && t1.weight != null && t0.weight > 0 && t1.weight > 0) {
            price = balancerImpliedPrice(t0.balance, t0.weight, t1.balance, t1.weight);
        } else if (t1.balance > 0 && t0.balance > 0) {
            // Fallback for unweighted pools: price is token1 per token0
            price = t1.balance / t0.balance;
        }
    }

    return {
        id: bp.id,
        token0: t0?.symbol ?? "?",
        token1: t1?.symbol ?? "?",
        icon0: tokenIcon(t0?.symbol ?? ""),
        icon1: tokenIcon(t1?.symbol ?? ""),
        protocol: "Balancer",
        // swapFee from subgraph is a fraction (e.g. 0.003); convert to percent
        fee: (bp.swapFee ?? 0) * 100,
        tvl: bp.tvlUsd,
        volume24h: bp.volume24hUsd,
        apy: bp.apr,
        feesEarned24h: bp.volume24hUsd * (bp.swapFee ?? 0),
        price,
        reserves0: t0?.balance ?? 0,
        reserves1: t1?.balance ?? 0,
    };
}

function calcPoolStats(positions: UserLpPosition[]): PoolStats {
    const totalTvl = positions.reduce((s, p) => s + p.valueUsd, 0);
    const totalFeesEarned = positions.reduce((s, p) => s + p.feesEarned, 0);
    const totalIL = positions.reduce((s, p) => s + p.impermanentLoss * p.valueUsd, 0) / (totalTvl || 1);
    const avgApy = positions.length > 0 ? positions.reduce((s, p) => s + p.feesEarned, 0) / (totalTvl || 1) * 100 : 0;
    return { totalTvl, totalFeesEarned, totalIL, avgApy };
}

function calcPriceImpact(
    pool: LiquidityPool,
    inputAmount: number,
    inputToken: string
): PriceImpact {
    const isToken0 = inputToken === pool.token0;
    const r0 = pool.reserves0;
    const r1 = pool.reserves1;
    const k = r0 * r1;
    const feeMultiplier = 1 - pool.fee / 100;
    const amountWithFee = inputAmount * feeMultiplier;

    let outputAmount: number;
    let priceImpact: number;
    let effectivePrice: number;
    if (isToken0) {
        const newR0 = r0 + amountWithFee;
        const newR1 = k / newR0;
        outputAmount = r1 - newR1;
        const spotPrice = r1 / r0;
        effectivePrice = outputAmount / inputAmount;
        priceImpact = Math.abs((effectivePrice - spotPrice) / spotPrice) * 100;
    } else {
        const newR1 = r1 + amountWithFee;
        const newR0 = k / newR1;
        outputAmount = r0 - newR0;
        const spotPrice = r0 / r1;
        effectivePrice = outputAmount / inputAmount;
        priceImpact = Math.abs((effectivePrice - spotPrice) / spotPrice) * 100;
    }

    return {
        inputToken,
        outputToken: isToken0 ? pool.token1 : pool.token0,
        inputAmount,
        outputAmount,
        priceImpact,
        fee: inputAmount * (pool.fee / 100),
        effectivePrice,
    };
}

export class AmmLiquidityViewModel implements ViewModel {
    viewType = "ammliquidity";
    blockId: string;

    viewIcon = jotai.atom<string>("droplet");
    viewName = jotai.atom<string>("AMM Liquidity Pools");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"pools" | "positions" | "swap" | "add">("pools");
    /** Populated from Balancer V2 subgraph on mount; empty until first fetch. */
    pools = jotai.atom<LiquidityPool[]>([]);
    userPositions = jotai.atom<UserLpPosition[]>([]);
    selectedPoolId = jotai.atom<string | null>(null) as jotai.PrimitiveAtom<string | null>;
    swapInputToken = jotai.atom<string>("ETH");
    swapInputAmount = jotai.atom<string>("");
    addLiquidityToken0 = jotai.atom<string>("");
    addLiquidityToken1 = jotai.atom<string>("");
    /** "live" once Balancer subgraph responds, "loading" during fetch, "error" if unavailable. */
    dataSource = jotai.atom<"live" | "loading" | "error">("loading");

    poolStats: jotai.Atom<PoolStats>;
    swapPreview: jotai.Atom<PriceImpact | null>;
    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;

        this.poolStats = jotai.atom((get) => {
            const positions = get(this.userPositions);
            return calcPoolStats(positions);
        });

        this.swapPreview = jotai.atom((get) => {
            const poolId = get(this.selectedPoolId);
            const inputToken = get(this.swapInputToken);
            const amountStr = get(this.swapInputAmount);
            const pools = get(this.pools);
            const pool = pools.find((p) => p.id === poolId);
            const inputAmount = parseFloat(amountStr);
            if (isNaN(inputAmount) || inputAmount <= 0) return null;
            if (!pool) return null;
            return calcPriceImpact(pool, inputAmount, inputToken);
        });

        this.viewText = jotai.atom((get) => {
            const stats = get(this.poolStats);
            const src = get(this.dataSource);
            const pools = get(this.pools);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: src === "live" ? `${pools.length} pools` : src === "loading" ? "Loading…" : "Balancer unavailable",
                    noGrow: true,
                },
                {
                    elemtype: "text",
                    text: stats.totalTvl > 0 ? `LP: $${stats.totalTvl.toLocaleString()}` : "",
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh pool data",
                    click: () => void this.initFromBalancer(),
                },
            ];
            return elems;
        });

        void this.initFromBalancer();
        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return AmmLiquidity as ViewComponent;
    }

    /**
     * Fetch live pool data from the Balancer V2 Arbitrum subgraph.
     * Maps subgraph records to LiquidityPool and enriches prices via CoinGecko.
     */
    async initFromBalancer() {
        globalStore.set(this.dataSource, "loading");
        try {
            const balancerPools = await fetchBalancerPools(100_000, 20);
            if (balancerPools.length === 0) {
                globalStore.set(this.dataSource, "error");
                return;
            }

            // Map subgraph records to LiquidityPool
            let liquidityPools: LiquidityPool[] = balancerPools.map(balancerToLiquidityPool);

            // Enrich prices using CoinGecko for any pool where implied price is 0
            const symbols = [...new Set(liquidityPools.flatMap((p) => [p.token0, p.token1]))];
            const cgPrices = await fetchTokenPrices(symbols).catch(() => ({} as Record<string, number>));
            if (Object.keys(cgPrices).length > 0) {
                liquidityPools = liquidityPools.map((p) => {
                    if (p.price > 0) return p;
                    const p0 = cgPrices[p.token0];
                    const p1 = cgPrices[p.token1];
                    if (p0 != null && p1 != null && p1 > 0) {
                        return { ...p, price: p0 / p1 };
                    }
                    return p;
                });
            }

            globalStore.set(this.pools, liquidityPools);
            // Auto-select first pool if nothing selected yet
            if (globalStore.get(this.selectedPoolId) == null && liquidityPools.length > 0) {
                globalStore.set(this.selectedPoolId, liquidityPools[0].id);
            }
            globalStore.set(this.dataSource, "live");
        } catch (e) {
            console.warn("[AmmLiquidity] Balancer subgraph unavailable", e);
            globalStore.set(this.dataSource, "error");
        }
    }

    refreshPools() {
        // Delegated to initFromBalancer; called periodically by startRefresh.
    }

    startRefresh() {
        // Re-fetch from Balancer every 60 s to pick up TVL/volume changes.
        this.refreshInterval = setInterval(() => {
            void this.initFromBalancer();
        }, 60000);
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
