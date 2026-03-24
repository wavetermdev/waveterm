// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
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
        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return TradingAlgoBot as ViewComponent;
    }

    toggleBot() {
        const current = globalStore.get(this.botRunning);
        globalStore.set(this.botRunning, !current);
    }

    refreshData() {
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
        const newPnl = 4000 + Math.random() * 2000;
        globalStore.set(this.totalPnl, newPnl);
    }

    startRefresh() {
        this.refreshInterval = setInterval(() => {
            const running = globalStore.get(this.botRunning);
            if (!running) return;
            // Tick price and update P&L
            const prev = globalStore.get(this.priceHistory);
            const last = prev[prev.length - 1];
            const newPrice = last.price * (1 + randomGaussian(0, 0.0008));
            const signal: "buy" | "sell" | undefined = Math.random() > 0.95 ? (Math.random() > 0.5 ? "buy" : "sell") : undefined;
            const next: PricePoint[] = [...prev.slice(1), { ts: Date.now(), price: newPrice, signal }];
            globalStore.set(this.priceHistory, next);
            // Drift P&L
            const pnl = globalStore.get(this.totalPnl);
            globalStore.set(this.totalPnl, pnl + randomGaussian(0, 8));
        }, 2000);
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
