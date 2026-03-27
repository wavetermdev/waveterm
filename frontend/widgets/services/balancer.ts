// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Balancer V2 REST API client for Arbitrum.
// Uses the Balancer public REST API (GET) instead of The Graph GraphQL.

const BALANCER_API = "https://api.balancer.fi/pools/arbitrum";

export type BalancerPoolToken = {
    symbol: string;
    address: string;
    weight: number | null;
    balance: number;
    priceUsd: number;
};

export type BalancerPool = {
    id: string;
    name: string;
    poolType: string;
    tvlUsd: number;
    volume24hUsd: number;
    apr: number;
    tokens: BalancerPoolToken[];
    swapFee: number;
};

type ApiPoolToken = {
    address: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    balance?: string | number;
    weight?: string | number | null;
};

type ApiPool = {
    id: string;
    address?: string;
    name?: string;
    poolType?: string;
    swapFee?: string | number;
    totalLiquidity?: string | number;
    // volume field names differ across API versions
    volume24h?: string | number;
    totalSwapVolume24h?: string | number;
    totalSwapVolume?: string | number;
    // APR
    aprItems?: Array<{ apr?: { total?: number } | number }>;
    apr?: number;
    tokens?: ApiPoolToken[];
};

function estimateTokenPriceUsd(symbol: string): number {
    const prices: Record<string, number> = {
        WETH: 3500,
        ETH: 3500,
        WBTC: 67000,
        BTC: 67000,
        USDC: 1,
        USDT: 1,
        DAI: 1,
        ARB: 1.2,
        BAL: 4.5,
    };
    return prices[symbol.toUpperCase()] ?? 1;
}

function parseNum(v: string | number | null | undefined): number {
    if (v == null) return 0;
    const n = typeof v === "number" ? v : parseFloat(v);
    return isNaN(n) ? 0 : n;
}

export async function fetchBalancerPools(
    minTvlUsd: number = 100_000,
    limit: number = 20
): Promise<BalancerPool[]> {
    try {
        const resp = await fetch(BALANCER_API, {
            headers: { Accept: "application/json" },
        });
        if (!resp.ok) return [];
        const json = (await resp.json()) as ApiPool[];
        if (!Array.isArray(json)) return [];

        return json
            .filter((p) => parseNum(p.totalLiquidity) >= minTvlUsd)
            .sort((a, b) => parseNum(b.totalLiquidity) - parseNum(a.totalLiquidity))
            .slice(0, limit)
            .map((p): BalancerPool => {
                const tvlUsd = parseNum(p.totalLiquidity);
                const swapFee = parseNum(p.swapFee);
                const volume24hUsd =
                    parseNum(p.volume24h) ||
                    parseNum(p.totalSwapVolume24h) ||
                    parseNum(p.totalSwapVolume) * 0.001;
                let apr = 0;
                if (p.apr != null) {
                    apr = parseNum(p.apr);
                } else if (Array.isArray(p.aprItems) && p.aprItems.length > 0) {
                    const first = p.aprItems[0].apr;
                    apr = typeof first === "number" ? first : parseNum(first?.total) ?? 0;
                } else if (tvlUsd > 0) {
                    apr = (volume24hUsd * swapFee * 365) / tvlUsd * 100;
                }

                const tokens: BalancerPoolToken[] = (p.tokens ?? []).map((t) => ({
                    symbol: t.symbol ?? t.address.slice(0, 6),
                    address: t.address,
                    weight: t.weight != null ? parseNum(t.weight) : null,
                    balance: parseNum(t.balance),
                    priceUsd: estimateTokenPriceUsd(t.symbol ?? ""),
                }));

                return {
                    id: p.id,
                    name: p.name ?? p.id.slice(0, 10),
                    poolType: p.poolType ?? "Unknown",
                    tvlUsd,
                    volume24hUsd,
                    apr,
                    tokens,
                    swapFee,
                };
            });
    } catch {
        return [];
    }
}

/**
 * Compute the implied price of token1 per token0 from a Balancer weighted pool.
 * Spot price formula (token1 per token0):
 *   spotPrice = (balance1 / weight1) / (balance0 / weight0)
 */
export function balancerImpliedPrice(
    balance0: number,
    weight0: number,
    balance1: number,
    weight1: number
): number {
    if (weight0 === 0 || balance0 === 0 || weight1 === 0) return 0;
    return balance1 / weight1 / (balance0 / weight0);
}
