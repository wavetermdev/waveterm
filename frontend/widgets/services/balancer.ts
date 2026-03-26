// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Balancer V2 subgraph + vault data for Arbitrum.

const BALANCER_SUBGRAPH =
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-arbitrum-v2";

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

type SubgraphToken = {
    symbol: string;
    address: string;
    weight: string | null;
    balance: string;
};

type SubgraphPool = {
    id: string;
    name: string;
    poolType: string;
    totalLiquidity: string;
    totalSwapVolume: string;
    swapFee: string;
    tokens: SubgraphToken[];
};

type SubgraphResponse = {
    data?: {
        pools?: SubgraphPool[];
    };
    errors?: Array<{ message: string }>;
};

function estimateTokenPriceUsd(symbol: string): number {
    // Simple price map for common tokens — subgraph doesn't return USD prices
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

export async function fetchBalancerPools(
    minTvlUsd: number = 100_000,
    limit: number = 20
): Promise<BalancerPool[]> {
    const query = `{
  pools(
    first: ${limit}
    orderBy: totalLiquidity
    orderDirection: desc
    where: { totalLiquidity_gt: "${minTvlUsd}" }
  ) {
    id
    name
    poolType
    totalLiquidity
    totalSwapVolume
    swapFee
    tokens {
      symbol
      address
      weight
      balance
    }
  }
}`;

    try {
        const resp = await fetch(BALANCER_SUBGRAPH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
        });
        if (!resp.ok) return [];
        const json = (await resp.json()) as SubgraphResponse;
        if (json.errors || !json.data?.pools) return [];

        return json.data.pools.map((p) => {
            const tvlUsd = parseFloat(p.totalLiquidity) || 0;
            const totalSwapVolume = parseFloat(p.totalSwapVolume) || 0;
            const swapFee = parseFloat(p.swapFee) || 0;
            // We don't have 24h volume directly; use total as proxy (subgraph v2 lacks it)
            const volume24hUsd = totalSwapVolume * 0.001; // rough daily estimate
            const apr = tvlUsd > 0 ? (volume24hUsd * swapFee * 365) / tvlUsd * 100 : 0;

            const tokens: BalancerPoolToken[] = (p.tokens ?? []).map((t) => ({
                symbol: t.symbol,
                address: t.address,
                weight: t.weight != null ? parseFloat(t.weight) : null,
                balance: parseFloat(t.balance) || 0,
                priceUsd: estimateTokenPriceUsd(t.symbol),
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
 * Compute the implied price of token0 in terms of token1 from a Balancer
 * weighted pool using the spot price formula:
 *   spotPrice = (balance0 / weight0) / (balance1 / weight1)
 */
export function balancerImpliedPrice(
    balance0: number,
    weight0: number,
    balance1: number,
    weight1: number
): number {
    if (weight0 === 0 || balance1 === 0 || weight1 === 0) return 0;
    return balance0 / weight0 / (balance1 / weight1);
}
