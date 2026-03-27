// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CoinGecko public REST API client — no API key required for basic endpoints.
// Rate limit: ~30 req/min on the free tier.

const CG_BASE = "https://api.coingecko.com/api/v3";

async function cgGet<T>(path: string): Promise<T> {
    const res = await fetch(`${CG_BASE}${path}`, {
        headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CoinGecko API ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
}

// ---- Types ----------------------------------------------------------------

/** Map of coingecko-id → {usd: price, usd_24h_change: pct} */
export type CgPriceMap = Record<string, { usd: number; usd_24h_change?: number; usd_market_cap?: number }>;

export type CgMarketData = {
    id: string;
    symbol: string;
    name: string;
    image?: string;
    current_price: number;
    price_change_percentage_24h: number;
    market_cap: number;
    total_volume: number;
    high_24h: number;
    low_24h: number;
    circulating_supply: number;
    total_supply: number | null;
};

// ---- Canonical ID map -------------------------------------------------------

/**
 * Maps the token symbols used in widget UIs to their CoinGecko IDs.
 * Extend as needed.
 */
export const CG_IDS: Record<string, string> = {
    ETH: "ethereum",
    WETH: "ethereum",
    WBTC: "wrapped-bitcoin",
    BTC: "bitcoin",
    USDC: "usd-coin",
    USDT: "tether",
    DAI: "dai",
    ARB: "arbitrum",
    GMX: "gmx",
    LINK: "chainlink",
    MAGIC: "magic",
    PENDLE: "pendle",
    OP: "optimism",
    AVAX: "avalanche-2",
    SOL: "solana",
    BNB: "binancecoin",
    MATIC: "matic-network",
    UNI: "uniswap",
    AAVE: "aave",
    CRV: "curve-dao-token",
    BAL: "balancer",
    MKR: "maker",
    SNX: "synthetix-network-token",
    COMP: "compound-governance-token",
    LDO: "lido-dao",
    RPL: "rocket-pool",
    RDNT: "radiant-capital",
};

// ---- API calls -------------------------------------------------------------

/**
 * Fetch USD prices for an array of token symbols.
 * Unknown symbols are silently skipped.
 */
export async function getCgPrices(symbols: string[]): Promise<CgPriceMap> {
    const ids = [...new Set(symbols.map((s) => CG_IDS[s.toUpperCase()]).filter(Boolean))];
    if (ids.length === 0) return {};
    const qs = `ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    return cgGet<CgPriceMap>(`/simple/price?${qs}`);
}

/**
 * Fetch detailed market data for a list of symbols.
 * Returns up to `perPage` items sorted by market cap.
 */
export async function getCgMarkets(symbols: string[], perPage = 50): Promise<CgMarketData[]> {
    const ids = [...new Set(symbols.map((s) => CG_IDS[s.toUpperCase()]).filter(Boolean))];
    if (ids.length === 0) return [];
    const qs = new URLSearchParams({
        vs_currency: "usd",
        ids: ids.join(","),
        order: "market_cap_desc",
        per_page: String(Math.min(perPage, 250)),
        page: "1",
        sparkline: "false",
        price_change_percentage: "24h",
    });
    return cgGet<CgMarketData[]>(`/coins/markets?${qs}`);
}

/**
 * Fetch CoinGecko token icon URLs for a list of symbols.
 * Returns a Record<SYMBOL, imageUrl> using the `image` field from /coins/markets.
 * Falls back to an empty object on error or unknown symbols.
 */
export async function fetchTokenImages(symbols: string[]): Promise<Record<string, string>> {
    try {
        const markets = await getCgMarkets(symbols, 250);
        const result: Record<string, string> = {};
        for (const m of markets) {
            if (m.image) {
                result[m.symbol.toUpperCase()] = m.image;
            }
        }
        return result;
    } catch {
        return {};
    }
}
export async function fetchTokenPrice(symbol: string): Promise<number | null> {
    try {
        const map = await getCgPrices([symbol]);
        const id = CG_IDS[symbol.toUpperCase()];
        if (!id) return null;
        return map[id]?.usd ?? null;
    } catch {
        return null;
    }
}

/**
 * Look up USD prices for multiple token symbols in one request.
 * Returns a Record<symbol, price>.  Missing entries are omitted.
 */
export async function fetchTokenPrices(symbols: string[]): Promise<Record<string, number>> {
    try {
        const cgMap = await getCgPrices(symbols);
        const result: Record<string, number> = {};
        for (const sym of symbols) {
            const id = CG_IDS[sym.toUpperCase()];
            if (id && cgMap[id]?.usd != null) {
                result[sym] = cgMap[id].usd;
            }
        }
        return result;
    } catch {
        return {};
    }
}
