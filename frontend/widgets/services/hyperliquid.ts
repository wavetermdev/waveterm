// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hyperliquid public REST API client — no API key required.
// Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint

const HL_BASE = "https://api.hyperliquid.xyz/info";

async function hlPost<T>(body: object): Promise<T> {
    const res = await fetch(HL_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Hyperliquid API ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
}

// ---- Types ----------------------------------------------------------------

export type HlAssetMeta = {
    name: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated?: boolean;
};

export type HlMeta = {
    universe: HlAssetMeta[];
};

/** One OHLCV candle from the candleSnapshot endpoint. */
export type HlCandle = {
    /** Open time (ms) */
    t: number;
    /** Close time (ms) */
    T: number;
    /** Coin ticker, e.g. "BTC" */
    s: string;
    /** Resolution string, e.g. "1m" */
    i: string;
    o: string; // open
    c: string; // close
    h: string; // high
    l: string; // low
    v: string; // base volume
    n: number; // number of trades
};

/** Symbol → mid price string, e.g. {"BTC":"67450.0"} */
export type HlAllMids = Record<string, string>;

export type HlOpenOrder = {
    coin: string;
    side: "B" | "A"; // B=buy/long, A=ask/sell/short
    limitPx: string;
    sz: string;
    oid: number;
    timestamp: number;
    origSz: string;
};

export type HlUserState = {
    assetPositions: Array<{
        position: {
            coin: string;
            szi: string;
            leverage: { type: string; value: number };
            entryPx: string;
            positionValue: string;
            unrealizedPnl: string;
            returnOnEquity: string;
            liquidationPx: string | null;
            marginUsed: string;
        };
        type: "oneWay";
    }>;
    marginSummary: {
        accountValue: string;
        totalNtlPos: string;
        totalRawUsd: string;
        totalMarginUsed: string;
    };
};

// ---- Public API calls -------------------------------------------------------

/** Fetch the full list of tradable perp assets from Hyperliquid. */
export async function getHlMeta(): Promise<HlMeta> {
    return hlPost<HlMeta>({ type: "meta" });
}

/**
 * Fetch OHLCV candles for a single coin.
 * @param coin     e.g. "BTC" (without "-PERP")
 * @param resolution  "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
 * @param startTime  epoch ms
 * @param endTime    epoch ms
 */
export async function getHlCandles(
    coin: string,
    resolution: string,
    startTime: number,
    endTime: number
): Promise<HlCandle[]> {
    return hlPost<HlCandle[]>({
        type: "candleSnapshot",
        req: { coin, resolution, startTime, endTime },
    });
}

/** Fetch all current mid prices for every perp. */
export async function getHlAllMids(): Promise<HlAllMids> {
    return hlPost<HlAllMids>({ type: "allMids" });
}

/**
 * Fetch open positions for a wallet address (read-only, no auth).
 * @param address  EVM wallet address (0x…)
 */
export async function getHlUserState(address: string): Promise<HlUserState> {
    return hlPost<HlUserState>({ type: "clearinghouseState", user: address });
}

// ---- Convenience helpers ---------------------------------------------------

/** Strip the "-PERP" suffix to get a raw coin name for Hyperliquid. */
export function toCoin(symbol: string): string {
    return symbol.replace(/-PERP$/i, "");
}

/** Convert a raw coin name back to the Wave terminal perp symbol. */
export function toSymbol(coin: string): string {
    return `${coin}-PERP`;
}

/**
 * Fetch the last `limit` 1-minute candles for `symbol` (e.g. "BTC-PERP").
 * Returns an empty array if the request fails.
 */
export async function fetchRecentOhlcv(symbol: string, limit = 60): Promise<HlCandle[]> {
    const coin = toCoin(symbol);
    const end = Date.now();
    const start = end - limit * 60 * 1000;
    try {
        return await getHlCandles(coin, "1m", start, end);
    } catch {
        return [];
    }
}

/**
 * Fetch the current mid price for a symbol.  Returns null if unavailable.
 */
export async function fetchMidPrice(symbol: string): Promise<number | null> {
    try {
        const mids = await getHlAllMids();
        const raw = mids[toCoin(symbol)];
        if (!raw) return null;
        return parseFloat(raw);
    } catch {
        return null;
    }
}
