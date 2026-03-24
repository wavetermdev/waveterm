// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { DeFiLendingViewModel, LendingAsset } from "./defilending-model";
import "./defilending.scss";

function HealthMeter({ healthFactor }: { healthFactor: number }) {
    const capped = Math.min(healthFactor, 10);
    const pct = Math.min(100, (capped / 10) * 100);
    const color = healthFactor < 1.1 ? "#ef4444" : healthFactor < 1.5 ? "#f59e0b" : "#22c55e";
    return (
        <div className="health-meter">
            <div className="health-bar-bg">
                <div className="health-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="health-label" style={{ color }}>
                {healthFactor > 100 ? "∞" : healthFactor.toFixed(2)}
            </span>
        </div>
    );
}

function UtilizationBar({ pct }: { pct: number }) {
    const color = pct > 85 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e";
    return (
        <div className="util-bar">
            <div className="util-bar-bg">
                <div className="util-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="util-label">{pct.toFixed(1)}%</span>
        </div>
    );
}

function MarketsTab({ model }: { model: DeFiLendingViewModel }) {
    const assets = useAtomValue(model.assets);

    return (
        <div className="widget-tab-content">
            <div className="lending-section">
                <div className="lending-section-header">Money Markets</div>
                <div className="markets-table">
                    <div className="markets-row header">
                        <span>Asset</span>
                        <span>Supply APY</span>
                        <span>ML Pred.</span>
                        <span>Borrow APY</span>
                        <span>Total Supply</span>
                        <span>Utilization</span>
                        <span>LTV</span>
                    </div>
                    {assets.map((a) => (
                        <div key={a.symbol} className="markets-row data">
                            <span className="asset-cell">
                                <span className="asset-icon">{a.icon}</span>
                                <span className="asset-sym">{a.symbol}</span>
                                <span className="asset-name">{a.name}</span>
                            </span>
                            <span className="apy-supply">
                                {a.supplyApy.toFixed(2)}%
                            </span>
                            <span className="apy-ml" title="ML predicted APY">
                                {a.mlPredictedApy.toFixed(2)}%
                                <span className="ml-badge">ML</span>
                            </span>
                            <span className="apy-borrow">
                                {a.borrowApy.toFixed(2)}%
                            </span>
                            <span className="supply-total">
                                ${(a.totalSupply * a.price / 1e6).toFixed(1)}M
                            </span>
                            <UtilizationBar pct={a.utilization} />
                            <span className="ltv-val">
                                {(a.ltv * 100).toFixed(0)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function PositionTab({ model }: { model: DeFiLendingViewModel }) {
    const positions = useAtomValue(model.userPositions);
    const assets = useAtomValue(model.assets);
    const health = useAtomValue(model.healthData);

    return (
        <div className="widget-tab-content">
            <div className="health-overview">
                <div className="health-stat">
                    <div className="hstat-label">Health Factor</div>
                    <HealthMeter healthFactor={health.healthFactor} />
                </div>
                <div className="health-stat">
                    <div className="hstat-label">Net APY</div>
                    <div className={`hstat-val ${health.netApy >= 0 ? "positive" : "negative"}`}>
                        {health.netApy >= 0 ? "+" : ""}
                        {health.netApy.toFixed(2)}%
                    </div>
                </div>
                <div className="health-stat">
                    <div className="hstat-label">Total Collateral</div>
                    <div className="hstat-val">${health.totalCollateral.toLocaleString()}</div>
                </div>
                <div className="health-stat">
                    <div className="hstat-label">Total Debt</div>
                    <div className="hstat-val negative">${health.totalBorrow.toLocaleString()}</div>
                </div>
                <div className="health-stat">
                    <div className="hstat-label">Available</div>
                    <div className="hstat-val positive">${health.availableToBorrow.toLocaleString()}</div>
                </div>
            </div>

            <div className="lending-section">
                <div className="lending-section-header">Your Positions</div>
                <div className="position-table">
                    {positions.filter((p) => p.supplied > 0 || p.borrowed > 0).map((pos) => {
                        const asset = assets.find((a) => a.symbol === pos.symbol);
                        if (!asset) return null;
                        return (
                            <div key={pos.symbol} className="position-row">
                                <span className="pos-asset">
                                    <span>{asset.icon}</span>
                                    <span className="pos-sym">{pos.symbol}</span>
                                    {pos.collateralEnabled && <span className="collateral-tag">Collateral</span>}
                                </span>
                                {pos.supplied > 0 && (
                                    <span className="pos-supplied">
                                        <span className="pos-lbl">Supplied</span>
                                        <span className="pos-amt positive">
                                            {pos.supplied.toLocaleString()} {pos.symbol}
                                        </span>
                                        <span className="pos-usd">
                                            ${(pos.supplied * asset.price).toLocaleString()}
                                        </span>
                                    </span>
                                )}
                                {pos.borrowed > 0 && (
                                    <span className="pos-borrowed">
                                        <span className="pos-lbl">Borrowed</span>
                                        <span className="pos-amt negative">
                                            {pos.borrowed.toLocaleString()} {pos.symbol}
                                        </span>
                                        <span className="pos-usd">
                                            ${(pos.borrowed * asset.price).toLocaleString()}
                                        </span>
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function ActionsTab({ model }: { model: DeFiLendingViewModel }) {
    const [selectedAction, setSelectedAction] = useAtom(model.selectedAction);
    const [selectedAsset, setSelectedAsset] = useAtom(model.selectedAsset);
    const [amount, setAmount] = useAtom(model.actionAmount);
    const swapRepaySteps = useAtomValue(model.swapRepaySteps);
    const assets = useAtomValue(model.assets);

    const actionTabs: Array<{ id: typeof selectedAction; label: string }> = [
        { id: "supply", label: "Supply" },
        { id: "borrow", label: "Borrow" },
        { id: "repay", label: "Repay" },
        { id: "withdraw", label: "Withdraw" },
        { id: "collateral-swap-repay", label: "Collateral Swap Repay" },
    ];

    return (
        <div className="widget-tab-content">
            <div className="action-tabs">
                {actionTabs.map((t) => (
                    <button
                        key={t.id}
                        className={`action-tab ${selectedAction === t.id ? "active" : ""}`}
                        onClick={() => setSelectedAction(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {selectedAction !== "collateral-swap-repay" ? (
                <div className="lending-section">
                    <div className="lending-section-header">
                        {selectedAction.charAt(0).toUpperCase() + selectedAction.slice(1)}
                    </div>
                    <div className="action-form">
                        <div className="form-field">
                            <label>Asset</label>
                            <select
                                value={selectedAsset}
                                onChange={(e) => setSelectedAsset(e.target.value)}
                                className="asset-select"
                            >
                                {assets.map((a) => (
                                    <option key={a.symbol} value={a.symbol}>
                                        {a.icon} {a.symbol} — {a.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-field">
                            <label>Amount</label>
                            <div className="amount-input-wrap">
                                <input
                                    type="number"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="amount-input"
                                />
                                <button className="max-btn" onClick={() => setAmount("1000")}>
                                    MAX
                                </button>
                            </div>
                        </div>
                        {(() => {
                            const asset = assets.find((a) => a.symbol === selectedAsset);
                            if (!asset) return null;
                            const apy = selectedAction === "supply" || selectedAction === "withdraw"
                                ? asset.supplyApy
                                : asset.borrowApy;
                            return (
                                <div className="action-info">
                                    <div className="info-row">
                                        <span>APY</span>
                                        <span className={selectedAction === "borrow" ? "negative" : "positive"}>
                                            {apy.toFixed(2)}%
                                        </span>
                                    </div>
                                    <div className="info-row">
                                        <span>ML Predicted APY</span>
                                        <span className="ml-predict">
                                            {asset.mlPredictedApy.toFixed(2)}% <span className="ml-badge">ML</span>
                                        </span>
                                    </div>
                                    <div className="info-row">
                                        <span>Utilization</span>
                                        <span>{asset.utilization.toFixed(1)}%</span>
                                    </div>
                                    {(selectedAction === "supply" || selectedAction === "borrow") && (
                                        <div className="info-row">
                                            <span>Max LTV</span>
                                            <span>{(asset.ltv * 100).toFixed(0)}%</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        <button className="action-submit-btn">
                            {selectedAction.charAt(0).toUpperCase() + selectedAction.slice(1)}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="lending-section">
                    <div className="lending-section-header">Collateralized Swap Repay</div>
                    <div className="swap-repay-info">
                        <p className="swap-repay-desc">
                            Atomically swaps collateral for debt token and repays the position without
                            requiring upfront capital. Uses a flash loan to cover the swap.
                        </p>
                    </div>
                    <div className="swap-repay-steps">
                        {swapRepaySteps.map((step) => (
                            <div key={step.id} className={`step-item step-${step.status}`}>
                                <div className="step-indicator">
                                    {step.status === "done" && "✓"}
                                    {step.status === "active" && "⟳"}
                                    {step.status === "pending" && step.id}
                                    {step.status === "error" && "✗"}
                                </div>
                                <div className="step-content">
                                    <div className="step-label">{step.label}</div>
                                    {step.txHash && (
                                        <div className="step-tx">
                                            tx: <span className="tx-hash">{step.txHash}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function ModelTab({ model }: { model: DeFiLendingViewModel }) {
    const assets = useAtomValue(model.assets);

    return (
        <div className="widget-tab-content">
            <div className="lending-section">
                <div className="lending-section-header">ML Rate Prediction Model</div>
                <div className="model-config">
                    <div className="config-row">
                        <span className="config-key">Architecture</span>
                        <span className="config-val">LSTM + Attention (PyTorch)</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Training Data</span>
                        <span className="config-val">Aave / Compound 24-month history</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Input Features</span>
                        <span className="config-val">Utilization rate, total supply, total borrow, price oracle</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">Prediction Horizon</span>
                        <span className="config-val">1h, 24h, 7d APY forecasts</span>
                    </div>
                    <div className="config-row">
                        <span className="config-key">MAE (test)</span>
                        <span className="config-val positive">0.18% APY</span>
                    </div>
                </div>
            </div>

            <div className="lending-section">
                <div className="lending-section-header">APY Predictions vs Current</div>
                <div className="apy-comparison">
                    {assets.map((a) => {
                        const diff = a.mlPredictedApy - a.supplyApy;
                        return (
                            <div key={a.symbol} className="apy-compare-row">
                                <span className="compare-asset">{a.icon} {a.symbol}</span>
                                <div className="compare-bars">
                                    <div className="compare-bar-row">
                                        <span className="bar-label">Current</span>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill current"
                                                style={{ width: `${Math.min(100, a.supplyApy * 8)}%` }}
                                            />
                                        </div>
                                        <span className="bar-val">{a.supplyApy.toFixed(2)}%</span>
                                    </div>
                                    <div className="compare-bar-row">
                                        <span className="bar-label">ML Pred.</span>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill predicted"
                                                style={{ width: `${Math.min(100, a.mlPredictedApy * 8)}%` }}
                                            />
                                        </div>
                                        <span className={`bar-val ${diff > 0 ? "positive" : "negative"}`}>
                                            {a.mlPredictedApy.toFixed(2)}%
                                            {diff !== 0 && (
                                                <span className="diff-tag">
                                                    {diff > 0 ? "▲" : "▼"}{Math.abs(diff).toFixed(2)}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export const DeFiLending: React.FC<ViewComponentProps<DeFiLendingViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    const tabs = [
        { id: "markets" as const, label: "Markets" },
        { id: "position" as const, label: "My Position" },
        { id: "actions" as const, label: "Actions" },
        { id: "model" as const, label: "ML Model" },
    ];

    return (
        <div className="defilending-widget">
            <div className="widget-header-bar">
                <div className="widget-title">
                    <span className="widget-icon">🏦</span>
                    <span>DeFi Lending Protocol</span>
                    <span className="widget-subtitle">Supply • Borrow • Collateral Swap Repay</span>
                </div>
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
                {activeTab === "markets" && <MarketsTab model={model} />}
                {activeTab === "position" && <PositionTab model={model} />}
                {activeTab === "actions" && <ActionsTab model={model} />}
                {activeTab === "model" && <ModelTab model={model} />}
            </div>
        </div>
    );
};
