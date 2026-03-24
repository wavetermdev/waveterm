// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { TradingAlgoBotViewModel } from "./tradingalgobot-model";
import "./tradingalgobot.scss";

function confidenceBar(val: number): React.ReactElement {
    const pct = Math.round(val * 100);
    const color = val >= 0.75 ? "#22c55e" : val >= 0.6 ? "#f59e0b" : "#ef4444";
    return (
        <div className="conf-bar-wrap">
            <div className="conf-bar-bg">
                <div className="conf-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="conf-bar-label">{pct}%</span>
        </div>
    );
}

function MiniChart({ points }: { points: Array<{ ts: number; price: number; signal?: string }> }) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || points.length < 2) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const prices = points.map((p) => p.price);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        const range = maxP - minP || 1;
        const toX = (i: number) => (i / (points.length - 1)) * w;
        const toY = (p: number) => h - ((p - minP) / range) * (h - 10) - 5;

        // Draw gradient fill
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(99,102,241,0.35)");
        grad.addColorStop(1, "rgba(99,102,241,0)");
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(prices[0]));
        for (let i = 1; i < prices.length; i++) ctx.lineTo(toX(i), toY(prices[i]));
        ctx.lineTo(toX(prices.length - 1), h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 1.5;
        ctx.moveTo(toX(0), toY(prices[0]));
        for (let i = 1; i < prices.length; i++) ctx.lineTo(toX(i), toY(prices[i]));
        ctx.stroke();

        // Draw signals
        points.forEach((pt, i) => {
            if (!pt.signal) return;
            const x = toX(i);
            const y = toY(pt.price);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = pt.signal === "buy" ? "#22c55e" : "#ef4444";
            ctx.fill();
        });
    }, [points]);
    return <canvas ref={canvasRef} className="mini-chart-canvas" width={320} height={90} />;
}

function OverviewTab({ model }: { model: TradingAlgoBotViewModel }) {
    const positions = useAtomValue(model.positions);
    const priceHistory = useAtomValue(model.priceHistory);
    const pnl = useAtomValue(model.totalPnl);
    const portfolioValue = useAtomValue(model.portfolioValue);
    const botRunning = useAtomValue(model.botRunning);
    const [selectedSymbol, setSelectedSymbol] = useAtom(model.selectedSymbol);

    const lastPrice = priceHistory[priceHistory.length - 1]?.price ?? 0;
    const prevPrice = priceHistory[priceHistory.length - 2]?.price ?? lastPrice;
    const priceDelta = ((lastPrice - prevPrice) / prevPrice) * 100;

    return (
        <div className="widget-tab-content">
            <div className="widget-stat-row">
                <div className="widget-stat-card">
                    <div className="stat-label">Portfolio Value</div>
                    <div className="stat-value">${portfolioValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                </div>
                <div className={`widget-stat-card ${pnl >= 0 ? "positive" : "negative"}`}>
                    <div className="stat-label">Total P&L</div>
                    <div className="stat-value">
                        {pnl >= 0 ? "+" : ""}
                        {pnl.toFixed(2)} USDC
                    </div>
                </div>
                <div className={`widget-stat-card ${botRunning ? "active" : "inactive"}`}>
                    <div className="stat-label">Bot Status</div>
                    <div className="stat-value">{botRunning ? "🟢 Running" : "🔴 Paused"}</div>
                </div>
                <div className={`widget-stat-card ${priceDelta >= 0 ? "positive" : "negative"}`}>
                    <div className="stat-label">{selectedSymbol}</div>
                    <div className="stat-value">${lastPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                    <div className="stat-sub">
                        {priceDelta >= 0 ? "▲" : "▼"} {Math.abs(priceDelta).toFixed(3)}%
                    </div>
                </div>
            </div>

            <div className="widget-section">
                <div className="widget-section-header">
                    <span>Price Chart — {selectedSymbol}</span>
                    <div className="symbol-pills">
                        {["BTC-PERP", "ETH-PERP", "SOL-PERP"].map((s) => (
                            <button
                                key={s}
                                className={`symbol-pill ${selectedSymbol === s ? "active" : ""}`}
                                onClick={() => setSelectedSymbol(s)}
                            >
                                {s.replace("-PERP", "")}
                            </button>
                        ))}
                    </div>
                </div>
                <MiniChart points={priceHistory} />
                <div className="chart-legend">
                    <span className="legend-item buy">● Buy Signal</span>
                    <span className="legend-item sell">● Sell Signal</span>
                    <span className="legend-item price">— Price</span>
                </div>
            </div>

            <div className="widget-section">
                <div className="widget-section-header">Open Positions ({positions.length})</div>
                <div className="positions-table">
                    <div className="table-header">
                        <span>Symbol</span>
                        <span>Side</span>
                        <span>Size</span>
                        <span>Entry</span>
                        <span>Mark</span>
                        <span>PnL</span>
                    </div>
                    {positions.map((pos) => (
                        <div key={pos.symbol} className="table-row">
                            <span className="symbol-name">{pos.symbol}</span>
                            <span className={`side-badge ${pos.side}`}>{pos.side.toUpperCase()}</span>
                            <span>{pos.size.toFixed(3)}</span>
                            <span>${pos.entryPrice.toFixed(2)}</span>
                            <span>${pos.currentPrice.toFixed(2)}</span>
                            <span className={pos.unrealizedPnl >= 0 ? "positive" : "negative"}>
                                {pos.unrealizedPnl >= 0 ? "+" : ""}
                                {pos.unrealizedPnl.toFixed(2)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SignalsTab({ model }: { model: TradingAlgoBotViewModel }) {
    const signals = useAtomValue(model.signals);

    return (
        <div className="widget-tab-content">
            <div className="widget-section">
                <div className="widget-section-header">Latest ML Model Signals</div>
                <div className="signals-list">
                    {signals.map((sig) => (
                        <div key={sig.id} className={`signal-card action-${sig.action}`}>
                            <div className="signal-header">
                                <span className="signal-symbol">{sig.symbol}</span>
                                <span className={`signal-action ${sig.action}`}>{sig.action.toUpperCase()}</span>
                                <span className="signal-model">{sig.modelType.toUpperCase()}</span>
                                <span className="signal-time">
                                    {new Date(sig.timestamp).toLocaleTimeString()}
                                </span>
                            </div>
                            <div className="signal-confidence">
                                <span>Confidence:</span>
                                {confidenceBar(sig.confidence)}
                            </div>
                            <div className="signal-features">
                                {Object.entries(sig.features).map(([k, v]) => (
                                    <div key={k} className="feature-chip">
                                        <span className="feature-key">{k.replace("_", " ")}:</span>
                                        <span className="feature-val">{v.toFixed(3)}</span>
                                    </div>
                                ))}
                                <div className="feature-chip highlight">
                                    <span className="feature-key">prediction:</span>
                                    <span className={`feature-val ${sig.prediction >= 0 ? "positive" : "negative"}`}>
                                        {sig.prediction >= 0 ? "+" : ""}
                                        {(sig.prediction * 100).toFixed(3)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MetricsTab({ model }: { model: TradingAlgoBotViewModel }) {
    const metrics = useAtomValue(model.metrics);

    return (
        <div className="widget-tab-content">
            <div className="widget-section">
                <div className="widget-section-header">Performance Metrics</div>
                <div className="metrics-grid">
                    {metrics.map((m) => (
                        <div key={m.label} className={`metric-card trend-${m.trend}`}>
                            <div className="metric-label">{m.label}</div>
                            <div className="metric-value">
                                {m.value >= 0 && m.trend !== "neutral" && m.unit !== "USDC" ? "" : ""}
                                {m.value.toFixed(m.decimals ?? 2)}
                                {m.unit && <span className="metric-unit">{m.unit}</span>}
                            </div>
                            <div className="metric-trend">
                                {m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "→"}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="widget-section">
                <div className="widget-section-header">ML Model Configuration</div>
                <div className="model-config">
                    <div className="config-row">
                        <span className="config-key">ONNX Model</span>
                        <span className="config-val">btc_price_predictor_v3.onnx</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Joblib Model</span>
                        <span className="config-val">gradient_boost_signal_v2.pkl</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Feature Set</span>
                        <span className="config-val">RSI, MACD, Bollinger, Volume, OI</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Inference Engine</span>
                        <span className="config-val">onnxruntime 1.17.1 + scikit-learn</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Hyperliquid API</span>
                        <span className="config-val connected">✓ Connected (mainnet)</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Update Frequency</span>
                        <span className="config-val">2s tick / 1m candle</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export const TradingAlgoBot: React.FC<ViewComponentProps<TradingAlgoBotViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    type TabId = "overview" | "signals" | "positions" | "metrics";
    const tabs: Array<{ id: TabId; label: string }> = [
        { id: "overview", label: "Overview" },
        { id: "signals", label: "ML Signals" },
        { id: "positions", label: "Positions" },
        { id: "metrics", label: "Metrics" },
    ];

    return (
        <div className="trading-algobot-widget">
            <div className="widget-header-bar">
                <div className="widget-title">
                    <span className="widget-icon">🤖</span>
                    <span>Hyperliquid Trading Algobot</span>
                    <span className="widget-subtitle">ONNX + Joblib ML Engine</span>
                </div>
            </div>
            <div className="widget-tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`widget-tab ${activeTab === tab.id ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.id as any)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="widget-body">
                {activeTab === "overview" && <OverviewTab model={model} />}
                {activeTab === "signals" && <SignalsTab model={model} />}
                {activeTab === "positions" && <OverviewTab model={model} />}
                {activeTab === "metrics" && <MetricsTab model={model} />}
            </div>
        </div>
    );
};
