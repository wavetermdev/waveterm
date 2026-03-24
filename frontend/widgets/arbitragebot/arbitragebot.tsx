// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { ArbitrageBotViewModel, ArbitrageOpportunity } from "./arbitragebot-model";
import "./arbitragebot.scss";

function StatusBadge({ status }: { status: ArbitrageOpportunity["status"] }) {
    const labels: Record<string, string> = {
        pending: "PENDING",
        executing: "EXECUTING",
        completed: "SUCCESS",
        failed: "FAILED",
        expired: "EXPIRED",
    };
    return <span className={`arb-status-badge status-${status}`}>{labels[status]}</span>;
}

function PathFlow({ path, dexes }: { path: string[]; dexes: string[] }) {
    return (
        <div className="path-flow">
            {path.map((token, i) => (
                <React.Fragment key={i}>
                    <span className="path-token">{token}</span>
                    {i < path.length - 1 && (
                        <span className="path-arrow">
                            <span className="path-dex">{dexes[i] ?? "DEX"}</span>→
                        </span>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}

function LiveTab({ model }: { model: ArbitrageBotViewModel }) {
    const opportunities = useAtomValue(model.opportunities);
    const lastScan = useAtomValue(model.lastScan);
    const stats = useAtomValue(model.stats);
    const botActive = useAtomValue(model.botActive);

    return (
        <div className="widget-tab-content">
            <div className="arb-stat-row">
                <div className="arb-stat-card">
                    <div className="stat-label">Status</div>
                    <div className={`stat-value ${botActive ? "active" : "inactive"}`}>
                        {botActive ? "🟢 Scanning" : "🔴 Paused"}
                    </div>
                    <div className="stat-sub">Last: {new Date(lastScan).toLocaleTimeString()}</div>
                </div>
                <div className="arb-stat-card">
                    <div className="stat-label">Win Rate</div>
                    <div className="stat-value positive">{stats.winRate.toFixed(1)}%</div>
                    <div className="stat-sub">{stats.successful}/{stats.executed} trades</div>
                </div>
                <div className="arb-stat-card">
                    <div className="stat-label">Total Profit</div>
                    <div className="stat-value positive">${stats.totalProfitUsd.toLocaleString()}</div>
                    <div className="stat-sub">Net of gas</div>
                </div>
                <div className="arb-stat-card">
                    <div className="stat-label">Avg Execution</div>
                    <div className="stat-value">{stats.avgExecutionMs}ms</div>
                    <div className="stat-sub">Avg profit {stats.avgProfitPct.toFixed(2)}%</div>
                </div>
            </div>

            <div className="arb-section">
                <div className="arb-section-header">
                    Arbitrage Opportunities — Arbitrum Network
                    <span className="badge">{opportunities.filter((o) => o.status === "pending").length} active</span>
                </div>
                <div className="arb-opps">
                    {opportunities.map((opp) => (
                        <div key={opp.id} className={`arb-opp-card status-${opp.status}`}>
                            <div className="opp-top">
                                <PathFlow path={opp.path} dexes={opp.dexes} />
                                <StatusBadge status={opp.status} />
                            </div>
                            <div className="opp-metrics">
                                <div className="opp-metric">
                                    <span className="opp-metric-label">Gross Profit</span>
                                    <span className="opp-metric-val positive">
                                        ${opp.profitUsd.toFixed(2)}
                                    </span>
                                </div>
                                <div className="opp-metric">
                                    <span className="opp-metric-label">Gas Cost</span>
                                    <span className="opp-metric-val negative">
                                        -${opp.gasEstimate.toFixed(2)}
                                    </span>
                                </div>
                                <div className="opp-metric">
                                    <span className="opp-metric-label">Net Profit</span>
                                    <span
                                        className={`opp-metric-val ${opp.netProfit >= 0 ? "positive" : "negative"}`}
                                    >
                                        ${opp.netProfit.toFixed(2)}
                                    </span>
                                </div>
                                <div className="opp-metric">
                                    <span className="opp-metric-label">Spread</span>
                                    <span className="opp-metric-val">
                                        {opp.profitPct.toFixed(3)}%
                                    </span>
                                </div>
                                <div className="opp-metric">
                                    <span className="opp-metric-label">ML Score</span>
                                    <span
                                        className={`opp-metric-val ${opp.confidence > 0.8 ? "positive" : opp.confidence > 0.65 ? "warning" : "negative"}`}
                                    >
                                        {(opp.confidence * 100).toFixed(1)}%
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

function PricesTab({ model }: { model: ArbitrageBotViewModel }) {
    const dexPrices = useAtomValue(model.dexPrices);

    const tokens = [...new Set(dexPrices.map((p) => p.token))];

    return (
        <div className="widget-tab-content">
            {tokens.map((token) => {
                const prices = dexPrices.filter((p) => p.token === token);
                const minP = Math.min(...prices.map((p) => p.price));
                const maxP = Math.max(...prices.map((p) => p.price));
                const spread = ((maxP - minP) / minP) * 100;
                return (
                    <div key={token} className="arb-section">
                        <div className="arb-section-header">
                            {token} Prices
                            <span className={`spread-badge ${spread > 0.15 ? "good" : "low"}`}>
                                Spread: {spread.toFixed(3)}%
                            </span>
                        </div>
                        <div className="price-table">
                            <div className="price-row header">
                                <span>DEX</span>
                                <span>Price</span>
                                <span>Liquidity</span>
                                <span>Fee</span>
                                <span>Delta</span>
                            </div>
                            {prices.map((p) => {
                                const delta = ((p.price - minP) / minP) * 100;
                                return (
                                    <div key={p.dex} className="price-row">
                                        <span className="dex-name">{p.dex}</span>
                                        <span className="price-val">
                                            ${p.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                                        </span>
                                        <span className="liq-val">
                                            ${(p.liquidity / 1000).toFixed(0)}K
                                        </span>
                                        <span className="fee-val">{p.fee}%</span>
                                        <span className={`delta-val ${delta > 0 ? "positive" : "zero"}`}>
                                            +{delta.toFixed(3)}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ModelTab({ model }: { model: ArbitrageBotViewModel }) {
    const predictions = React.useMemo(() => model.getMlPredictions(), []);

    return (
        <div className="widget-tab-content">
            <div className="arb-section">
                <div className="arb-section-header">ML Model — Triangular Arbitrage Classifier</div>
                <div className="model-info">
                    <div className="info-grid">
                        <div className="info-item">
                            <span className="info-key">Architecture</span>
                            <span className="info-val">GBM + Neural Feature Extractor</span>
                        </div>
                        <div className="info-item">
                            <span className="info-key">Framework</span>
                            <span className="info-val">scikit-learn + PyTorch</span>
                        </div>
                        <div className="info-item">
                            <span className="info-key">Training Data</span>
                            <span className="info-val">18 months Arbitrum DEX history</span>
                        </div>
                        <div className="info-item">
                            <span className="info-key">Features</span>
                            <span className="info-val">Price spread, liquidity, gas, volatility</span>
                        </div>
                        <div className="info-item">
                            <span className="info-key">Network</span>
                            <span className="info-val connected">✓ Arbitrum One (Chain ID: 42161)</span>
                        </div>
                        <div className="info-item">
                            <span className="info-key">Latency Target</span>
                            <span className="info-val">&lt;200ms execution</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="arb-section">
                <div className="arb-section-header">Current Predictions</div>
                <div className="predictions-list">
                    {predictions.map((pred, i) => (
                        <div key={pred.opportunityId} className="prediction-card">
                            <div className="pred-header">
                                <span className="pred-id">Opp #{i + 1}</span>
                                <span className={`pred-score ${pred.score > 0.8 ? "high" : pred.score > 0.65 ? "medium" : "low"}`}>
                                    Score: {(pred.score * 100).toFixed(1)}%
                                </span>
                            </div>
                            <div className="pred-features">
                                {Object.entries(pred.features).map(([k, v]) => (
                                    <div key={k} className="pred-feat">
                                        <span className="feat-key">{k.replace(/_/g, " ")}</span>
                                        <div className="feat-bar-wrap">
                                            <div
                                                className="feat-bar"
                                                style={{ width: `${Math.min(100, Math.abs(v) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="feat-val">{v.toFixed(4)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export const ArbitrageBot: React.FC<ViewComponentProps<ArbitrageBotViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    const tabs = [
        { id: "live" as const, label: "Live Feed" },
        { id: "prices" as const, label: "DEX Prices" },
        { id: "history" as const, label: "History" },
        { id: "model" as const, label: "ML Model" },
    ];

    return (
        <div className="arbitragebot-widget">
            <div className="widget-header-bar">
                <div className="widget-title">
                    <span className="widget-icon">⚡</span>
                    <span>Triangular Arbitrage Bot</span>
                    <span className="widget-subtitle">Arbitrum Network • ML-Powered</span>
                </div>
                <div className="network-badge">ARB</div>
            </div>
            <div className="widget-tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`widget-tab ${activeTab === tab.id ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="widget-body">
                {activeTab === "live" && <LiveTab model={model} />}
                {activeTab === "prices" && <PricesTab model={model} />}
                {activeTab === "history" && <LiveTab model={model} />}
                {activeTab === "model" && <ModelTab model={model} />}
            </div>
        </div>
    );
};
