// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { fetchTokenPrices } from "../services/coingecko";
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

function generatePools(): LiquidityPool[] {
    return [
        {
            id: "pool-1",
            token0: "ETH",
            token1: "USDC",
            icon0: "💎",
            icon1: "💵",
            protocol: "Uniswap V3",
            fee: 0.05,
            tvl: 184500000,
            volume24h: 42300000,
            apy: 18.4,
            feesEarned24h: 21150,
            price: 3520,
            reserves0: 28000,
            reserves1: 98560000,
        },
        {
            id: "pool-2",
            token0: "WBTC",
            token1: "ETH",
            icon0: "₿",
            icon1: "💎",
            protocol: "Uniswap V3",
            fee: 0.05,
            tvl: 87200000,
            volume24h: 18400000,
            apy: 12.7,
            feesEarned24h: 9200,
            price: 19.15,
            reserves0: 648,
            reserves1: 12402,
        },
        {
            id: "pool-3",
            token0: "ARB",
            token1: "ETH",
            icon0: "🔵",
            icon1: "💎",
            protocol: "Camelot",
            fee: 0.3,
            tvl: 42100000,
            volume24h: 8700000,
            apy: 34.2,
            feesEarned24h: 26100,
            price: 0.000352,
            reserves0: 17000000,
            reserves1: 5984,
        },
        {
            id: "pool-4",
            token0: "USDC",
            token1: "DAI",
            icon0: "💵",
            icon1: "🟡",
            protocol: "Curve",
            fee: 0.04,
            tvl: 234000000,
            volume24h: 81000000,
            apy: 4.8,
            feesEarned24h: 32400,
            price: 1.0,
            reserves0: 117000000,
            reserves1: 117000000,
        },
        {
            id: "pool-5",
            token0: "GMX",
            token1: "ETH",
            icon0: "🎯",
            icon1: "💎",
            protocol: "Balancer",
            fee: 0.3,
            tvl: 28300000,
            volume24h: 5400000,
            apy: 22.1,
            feesEarned24h: 16200,
            price: 0.012,
            reserves0: 180000,
            reserves1: 2160,
        },
    ];
}

function generateUserPositions(): UserLpPosition[] {
    return [
        {
            poolId: "pool-1",
            liquidityTokens: 0.00842,
            token0Amount: 1.42,
            token1Amount: 4998,
            valueUsd: 9997,
            feesEarned: 48.32,
            impermanentLoss: -1.24,
            entryPrice: 3480,
        },
        {
            poolId: "pool-3",
            liquidityTokens: 12400,
            token0Amount: 8200,
            token1Amount: 2.88,
            valueUsd: 3758,
            feesEarned: 22.14,
            impermanentLoss: -0.87,
            entryPrice: 0.000348,
        },
    ];
}

function calcPoolStats(positions: UserLpPosition[]): PoolStats {
    const totalTvl = positions.reduce((s, p) => s + p.valueUsd, 0);
    const totalFeesEarned = positions.reduce((s, p) => s + p.feesEarned, 0);
    const totalIL = positions.reduce((s, p) => s + p.impermanentLoss * p.valueUsd, 0) / (totalTvl || 1);
    const avgApy = positions.length > 0 ? 21.3 : 0;
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
    pools = jotai.atom<LiquidityPool[]>(generatePools());
    userPositions = jotai.atom<UserLpPosition[]>(generateUserPositions());
    selectedPoolId = jotai.atom<string>("pool-1");
    swapInputToken = jotai.atom<string>("ETH");
    swapInputAmount = jotai.atom<string>("");
    addLiquidityToken0 = jotai.atom<string>("");
    addLiquidityToken1 = jotai.atom<string>("");

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
            if (!pool || !amountStr) return null;
            const inputAmount = parseFloat(amountStr);
            if (isNaN(inputAmount) || inputAmount <= 0) return null;
            return calcPriceImpact(pool, inputAmount, inputToken);
        });

        this.viewText = jotai.atom((get) => {
            const stats = get(this.poolStats);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `LP Value: $${stats.totalTvl.toLocaleString()}`,
                    noGrow: true,
                },
                {
                    elemtype: "text",
                    text: `Fees: $${stats.totalFeesEarned.toFixed(2)}`,
                    className: "widget-fees-earned",
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh pool data",
                    click: () => this.refreshPools(),
                },
            ];
            return elems;
        });

        // Try to seed pool prices from CoinGecko on load
        void this.initLivePrices();
        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return AmmLiquidity as ViewComponent;
    }

    /** Fetch live token prices for all pools and update their price fields. */
    async initLivePrices() {
        try {
            const pools = globalStore.get(this.pools);
            const symbols = [...new Set(pools.flatMap((p) => [p.token0, p.token1]))];
            const prices = await fetchTokenPrices(symbols);
            if (Object.keys(prices).length === 0) return;
            const updated = pools.map((p) => {
                const p0 = prices[p.token0];
                const p1 = prices[p.token1];
                if (p0 != null && p1 != null && p1 > 0) {
                    return { ...p, price: p0 / p1 };
                }
                return p;
            });
            globalStore.set(this.pools, updated);
        } catch (e) {
            console.warn("[AmmLiquidity] CoinGecko unavailable – using mock prices", e);
        }
    }

    refreshPools() {
        const current = globalStore.get(this.pools);
        const updated = current.map((p) => ({
            ...p,
            volume24h: p.volume24h * (1 + (Math.random() - 0.5) * 0.05),
            apy: Math.max(0.1, p.apy + (Math.random() - 0.5) * 0.5),
            price: p.price * (1 + (Math.random() - 0.5) * 0.003),
            feesEarned24h: p.feesEarned24h * (1 + (Math.random() - 0.5) * 0.03),
        }));
        globalStore.set(this.pools, updated);
    }

    startRefresh() {
        let tick = 0;
        this.refreshInterval = setInterval(() => {
            this.refreshPools();
            tick++;
            if (tick % 8 === 0) void this.initLivePrices();
        }, 4000);
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
