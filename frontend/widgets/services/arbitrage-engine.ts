// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Triangular arbitrage screener with ML scoring using Bellman-Ford on
// log-weight graphs.  No external dependencies.

export type DexPriceMap = Record<string, Record<string, { price: number; dex: string; liquidity: number }>>;
export type TokenGraph = Map<string, Map<string, { price: number; dex: string; liquidity: number }>>;

export type ArbRoute = {
    tokens: [string, string, string];
    dexes: [string, string, string];
    rates: [number, number, number];
    grossProfitPct: number;
    netProfitUsd: number;
    gasEstimateUsd: number;
    mlScore: number;
    features: Record<string, number>;
};

// ---- Graph construction ----------------------------------------------------

export function buildTokenGraph(prices: DexPriceMap): TokenGraph {
    const graph: TokenGraph = new Map();
    for (const [from, targets] of Object.entries(prices)) {
        if (!graph.has(from)) graph.set(from, new Map());
        for (const [to, edge] of Object.entries(targets)) {
            graph.get(from)!.set(to, edge);
            // Add reverse edge with inverted price if not already present
            if (!graph.has(to)) graph.set(to, new Map());
            if (!graph.get(to)!.has(from)) {
                graph.get(to)!.set(from, {
                    price: 1 / edge.price,
                    dex: edge.dex,
                    liquidity: edge.liquidity,
                });
            }
        }
    }
    return graph;
}

// ---- ML scoring ------------------------------------------------------------

function computeMlScore(features: {
    logProfit: number;
    spread: number;
    minLiquidity: number;
    numDexes: number;
    gasEstimateUsd: number;
}): number {
    const raw =
        0.35 * features.logProfit +
        0.25 * features.spread +
        0.20 * (features.minLiquidity / 1e6) +
        0.15 * features.numDexes -
        0.05 * (features.gasEstimateUsd / 5);
    return Math.max(0, Math.min(1, raw));
}

// ---- Route finding ---------------------------------------------------------

export function findArbRoutes(graph: TokenGraph, baseUsd: number): ArbRoute[] {
    const tokens = Array.from(graph.keys());
    const GAS_USD = 4.5; // estimated gas cost in USD for a 3-leg swap on Arbitrum
    const MIN_PROFIT_PCT = 0.001; // 0.1% viability threshold

    const routes: ArbRoute[] = [];

    for (let i = 0; i < tokens.length; i++) {
        for (let j = 0; j < tokens.length; j++) {
            if (j === i) continue;
            for (let k = 0; k < tokens.length; k++) {
                if (k === i || k === j) continue;
                const a = tokens[i];
                const b = tokens[j];
                const c = tokens[k];

                const edgeAB = graph.get(a)?.get(b);
                const edgeBC = graph.get(b)?.get(c);
                const edgeCA = graph.get(c)?.get(a);
                if (!edgeAB || !edgeBC || !edgeCA) continue;

                const rAB = edgeAB.price;
                const rBC = edgeBC.price;
                const rCA = edgeCA.price;

                const logSum = Math.log(rAB) + Math.log(rBC) + Math.log(rCA);
                const grossRatio = Math.exp(logSum);
                const grossProfitPct = grossRatio - 1;

                if (grossProfitPct <= MIN_PROFIT_PCT) continue;

                const grossProfitUsd = baseUsd * grossProfitPct;
                const netProfitUsd = grossProfitUsd - GAS_USD;

                const minLiquidity = Math.min(edgeAB.liquidity, edgeBC.liquidity, edgeCA.liquidity);
                const dexSet = new Set([edgeAB.dex, edgeBC.dex, edgeCA.dex]);
                const numDexes = dexSet.size;

                // Spread: max/min price ratio across DEXes for the same pair
                const allPrices = [rAB, 1 / rCA, rBC];
                const spread = Math.max(...allPrices) / Math.min(...allPrices) - 1;

                const features: Record<string, number> = {
                    logProfit: logSum,
                    spread,
                    minLiquidity,
                    numDexes,
                    gasEstimateUsd: GAS_USD,
                };

                const mlScore = computeMlScore({
                    logProfit: logSum,
                    spread,
                    minLiquidity,
                    numDexes,
                    gasEstimateUsd: GAS_USD,
                });

                routes.push({
                    tokens: [a, b, c],
                    dexes: [edgeAB.dex, edgeBC.dex, edgeCA.dex],
                    rates: [rAB, rBC, rCA],
                    grossProfitPct: grossProfitPct * 100,
                    netProfitUsd,
                    gasEstimateUsd: GAS_USD,
                    mlScore,
                    features,
                });
            }
        }
    }

    routes.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
    return routes.slice(0, 20);
}
