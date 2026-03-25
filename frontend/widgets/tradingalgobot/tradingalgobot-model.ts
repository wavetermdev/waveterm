// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { fetchRecentOhlcv, getHlAllMids, getHlMeta, toCoin } from "../services/hyperliquid";
import { TradingAlgoBot } from "./tradingalgobot";

export type TradingPosition = {
    symbol: string;
    side: "long" | "short";
    size: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    leverage: number;
};

export type TradeSignal = {
    id: string;
    symbol: string;
    action: "buy" | "sell" | "hold";
    confidence: number;
    modelType: "onnx" | "joblib";
    timestamp: number;
    features: Record<string, number>;
    prediction: number;
};

export type PerformanceMetric = {
    label: string;
    value: number;
    unit: string;
    trend: "up" | "down" | "neutral";
    decimals?: number;
};

export type PricePoint = {
    ts: number;
    price: number;
    signal?: "buy" | "sell";
};

const SYMBOLS = ["BTC-PERP", "ETH-PERP", "SOL-PERP", "ARB-PERP", "AVAX-PERP"];

function randomGaussian(mean: number, std: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function generateMockPositions(): TradingPosition[] {
    const basePrices: Record<string, number> = {
        "BTC-PERP": 67450,
        "ETH-PERP": 3520,
        "SOL-PERP": 182,
        "ARB-PERP": 1.24,
        "AVAX-PERP": 38.5,
    };
    return SYMBOLS.slice(0, 3).map((symbol) => {
        const entry = basePrices[symbol] * (1 + randomGaussian(0, 0.02));
        const current = basePrices[symbol];
        const size = Math.random() * 2 + 0.1;
        const side: "long" | "short" = Math.random() > 0.4 ? "long" : "short";
        const pnl = side === "long" ? (current - entry) * size : (entry - current) * size;
        return { symbol, side, size, entryPrice: entry, currentPrice: current, unrealizedPnl: pnl, leverage: 5 };
    });
}

function generateMockSignals(): TradeSignal[] {
    return SYMBOLS.map((symbol, i) => {
        const actions: Array<"buy" | "sell" | "hold"> = ["buy", "sell", "hold", "buy", "hold"];
        return {
            id: `sig-${Date.now()}-${i}`,
            symbol,
            action: actions[i],
            confidence: 0.55 + Math.random() * 0.4,
            modelType: i % 2 === 0 ? "onnx" : "joblib",
            timestamp: Date.now() - i * 15000,
            features: {
                rsi: 30 + Math.random() * 40,
                macd: randomGaussian(0, 0.5),
                volume_ratio: 0.8 + Math.random() * 0.8,
                bollinger_pct: Math.random(),
            },
            prediction: randomGaussian(0, 0.015),
        };
    });
}

function generatePriceHistory(basePrice: number, count: number): PricePoint[] {
    const now = Date.now();
    const points: PricePoint[] = [];
    let price = basePrice;
    for (let i = count; i >= 0; i--) {
        price = price * (1 + randomGaussian(0, 0.002));
        const signal = Math.random() > 0.92 ? (Math.random() > 0.5 ? "buy" : "sell") : undefined;
        points.push({ ts: now - i * 60000, price, signal });
    }
    return points;
}

function generatePerformanceMetrics(): PerformanceMetric[] {
    return [
        { label: "Total P&L", value: 4823.5, unit: "USDC", trend: "up", decimals: 2 },
        { label: "Win Rate", value: 67.3, unit: "%", trend: "up", decimals: 1 },
        { label: "Sharpe Ratio", value: 2.14, unit: "", trend: "up", decimals: 2 },
        { label: "Max Drawdown", value: -8.4, unit: "%", trend: "down", decimals: 1 },
        { label: "Model Accuracy", value: 71.2, unit: "%", trend: "up", decimals: 1 },
        { label: "Avg Trade", value: 18.9, unit: "USDC", trend: "up", decimals: 2 },
        { label: "Trades Today", value: 23, unit: "", trend: "neutral", decimals: 0 },
        { label: "Open Positions", value: 3, unit: "", trend: "neutral", decimals: 0 },
    ];
}

export class TradingAlgoBotViewModel implements ViewModel {
    viewType = "tradingalgobot";
    blockId: string;

    viewIcon = jotai.atom<string>("robot");
    viewName = jotai.atom<string>("Trading Algobot");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"overview" | "signals" | "positions" | "metrics">("overview");
    positions = jotai.atom<TradingPosition[]>(generateMockPositions());
    signals = jotai.atom<TradeSignal[]>(generateMockSignals());
    metrics = jotai.atom<PerformanceMetric[]>(generatePerformanceMetrics());
    priceHistory = jotai.atom<PricePoint[]>(generatePriceHistory(67450, 60));
    selectedSymbol = jotai.atom<string>("BTC-PERP");
    botRunning = jotai.atom<boolean>(true);
    totalPnl = jotai.atom<number>(4823.5);
    portfolioValue = jotai.atom<number>(52340.75);

    /** All perp symbols available on Hyperliquid (populated on load). */
    availableSymbols = jotai.atom<string[]>(SYMBOLS);
    /** "live" when Hyperliquid API is reachable, "demo" otherwise. */
    dataSource = jotai.atom<"live" | "demo">("demo");
    /** Timestamp of the last successful live data fetch. */
    lastLiveUpdate = jotai.atom<number>(0);

    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const running = get(this.botRunning);
            const pnl = get(this.totalPnl);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDC`,
                    className: pnl >= 0 ? "widget-pnl-positive" : "widget-pnl-negative",
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: running ? "pause" : "play",
                    title: running ? "Pause Bot" : "Start Bot",
                    click: () => this.toggleBot(),
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh Data",
                    click: () => this.refreshData(),
                },
            ];
            return elems;
        });
        // Try to connect to live Hyperliquid data; fall back to mock seamlessly
        void this.initLiveData();
        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return TradingAlgoBot as ViewComponent;
    }

    /** Bootstrap live data on first load. */
    async initLiveData() {
        try {
            // Populate the full symbol list from Hyperliquid meta
            const meta = await getHlMeta();
            const syms = meta.universe.map((u) => `${u.name}-PERP`);
            if (syms.length > 0) globalStore.set(this.availableSymbols, syms);

            // Fetch real OHLCV for the default symbol
            await this.fetchLiveOhlcv(globalStore.get(this.selectedSymbol));

            // Fetch real mid prices and build positions
            await this.fetchLivePositions();

            globalStore.set(this.dataSource, "live");
            globalStore.set(this.lastLiveUpdate, Date.now());
        } catch (e) {
            console.warn("[TradingAlgoBot] Hyperliquid unavailable – running in demo mode", e);
            globalStore.set(this.dataSource, "demo");
        }
    }

    /** Fetch real 1-min candles from Hyperliquid and replace priceHistory. */
    async fetchLiveOhlcv(symbol: string) {
        const candles = await fetchRecentOhlcv(symbol, 60);
        if (candles.length === 0) return;
        const history: PricePoint[] = candles.map((c) => ({
            ts: c.t,
            price: parseFloat(c.c),
            signal: undefined,
        }));
        globalStore.set(this.priceHistory, history);
    }

    /** Fetch allMids and synthesise positions with real current prices. */
    async fetchLivePositions() {
        const mids = await getHlAllMids();
        const syms = globalStore.get(this.availableSymbols).slice(0, 5);
        const positions: TradingPosition[] = [];
        syms.slice(0, 3).forEach((sym, i) => {
            const coin = toCoin(sym);
            const current = parseFloat(mids[coin] ?? "0");
            if (current <= 0) return;
            const side: "long" | "short" = i % 2 === 0 ? "long" : "short";
            const size = 0.1 + i * 0.05;
            const entryOffset = i === 1 ? -0.008 : 0.008;
            const entry = current * (1 + entryOffset);
            const pnl = side === "long" ? (current - entry) * size : (entry - current) * size;
            positions.push({ symbol: sym, side, size, entryPrice: entry, currentPrice: current, unrealizedPnl: pnl, leverage: 5 });
        });
        if (positions.length > 0) {
            globalStore.set(this.positions, positions);
        }
    }

    toggleBot() {
        const current = globalStore.get(this.botRunning);
        globalStore.set(this.botRunning, !current);
    }

    async refreshData() {
        const source = globalStore.get(this.dataSource);
        if (source === "live") {
            try {
                await this.fetchLiveOhlcv(globalStore.get(this.selectedSymbol));
                await this.fetchLivePositions();
                globalStore.set(this.lastLiveUpdate, Date.now());
                return;
            } catch {
                // fall through to mock refresh
            }
        }
        globalStore.set(this.positions, generateMockPositions());
        globalStore.set(this.signals, generateMockSignals());
        globalStore.set(this.metrics, generatePerformanceMetrics());
        const sym = globalStore.get(this.selectedSymbol);
        const basePrices: Record<string, number> = {
            "BTC-PERP": 67450,
            "ETH-PERP": 3520,
            "SOL-PERP": 182,
            "ARB-PERP": 1.24,
            "AVAX-PERP": 38.5,
        };
        globalStore.set(this.priceHistory, generatePriceHistory(basePrices[sym] ?? 67450, 60));
        globalStore.set(this.totalPnl, 4000 + Math.random() * 2000);
    }

    /** Append a single live price tick to the chart. */
    private async liveTick() {
        try {
            const sym = globalStore.get(this.selectedSymbol);
            const mids = await getHlAllMids();
            const newPrice = parseFloat(mids[toCoin(sym)] ?? "0");
            if (newPrice <= 0) return;
            const prev = globalStore.get(this.priceHistory);
            const next: PricePoint[] = [...prev.slice(1), { ts: Date.now(), price: newPrice, signal: undefined }];
            globalStore.set(this.priceHistory, next);
            // Update P&L from live positions
            await this.fetchLivePositions();
            const positions = globalStore.get(this.positions);
            const pnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0) * 100;
            globalStore.set(this.totalPnl, pnl);
            globalStore.set(this.lastLiveUpdate, Date.now());
        } catch {
            this.mockTick();
        }
    }

    /** Gaussian random-walk tick used in demo mode. */
    private mockTick() {
        const prev = globalStore.get(this.priceHistory);
        if (prev.length === 0) return;
        const last = prev[prev.length - 1];
        const newPrice = last.price * (1 + randomGaussian(0, 0.0008));
        const signal: "buy" | "sell" | undefined = Math.random() > 0.95 ? (Math.random() > 0.5 ? "buy" : "sell") : undefined;
        globalStore.set(this.priceHistory, [...prev.slice(1), { ts: Date.now(), price: newPrice, signal }]);
        const pnl = globalStore.get(this.totalPnl);
        globalStore.set(this.totalPnl, pnl + randomGaussian(0, 8));
    }

    startRefresh() {
        // 5 s interval — respects Hyperliquid public rate limits
        this.refreshInterval = setInterval(() => {
            const running = globalStore.get(this.botRunning);
            if (!running) return;
            if (globalStore.get(this.dataSource) === "live") {
                void this.liveTick();
            } else {
                this.mockTick();
            }
        }, 5000);
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
