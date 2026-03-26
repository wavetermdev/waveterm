// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { FlashLoanViewModel, FlashLoanStrategy } from "./flashloan-model";
import "./flashloan.scss";

function AllocationBar({ current, target }: { current: number; target: number }) {
    return (
        <div className="alloc-bar-wrap">
            <div className="alloc-bar-track">
                <div className="alloc-bar-current" style={{ width: `${current}%` }} />
                <div className="alloc-bar-target" style={{ left: `${target}%` }} />
            </div>
            <div className="alloc-labels">
                <span className="alloc-current">{current}%</span>
                <span className="alloc-arrow">→</span>
                <span className="alloc-target">{target}%</span>
            </div>
        </div>
    );
}

function PortfolioTab({ model }: { model: FlashLoanViewModel }) {
    const portfolio = useAtomValue(model.portfolio);
    const rebalanceTrades = useAtomValue(model.rebalanceTrades);
    const totalValue = useAtomValue(model.totalPortfolioValue);

    return (
        <div className="widget-tab-content">
            <div className="portfolio-overview">
                <div className="port-stat">
                    <div className="port-stat-label">Total Value</div>
                    <div className="port-stat-val">${totalValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                </div>
                <div className="port-stat">
                    <div className="port-stat-label">Rebalance Required</div>
                    <div className={`port-stat-val ${rebalanceTrades.length > 0 ? "warning" : "positive"}`}>
                        {rebalanceTrades.length > 0 ? `${rebalanceTrades.length} trades` : "✓ Balanced"}
                    </div>
                </div>
                <div className="port-stat">
                    <div className="port-stat-label">Flash Loan Fee</div>
                    <div className="port-stat-val">0.09% (Aave)</div>
                </div>
            </div>

            <div className="flash-section">
                <div className="flash-section-header">Portfolio Allocation</div>
                <div className="alloc-table">
                    {portfolio.map((a) => (
                        <div key={a.symbol} className="alloc-row">
                            <span className="alloc-asset">
                                <span className="alloc-icon">{a.icon}</span>
                                <span className="alloc-sym">{a.symbol}</span>
                            </span>
                            <AllocationBar current={a.currentPct} target={a.targetPct} />
                            <span className="alloc-value">${a.value.toLocaleString()}</span>
                            <span className="alloc-price">${a.price.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </div>

            {rebalanceTrades.length > 0 && (
                <div className="flash-section">
                    <div className="flash-section-header">Required Rebalance Trades</div>
                    <div className="trades-list">
                        {rebalanceTrades.map((t, i) => (
                            <div key={i} className={`trade-row action-${t.action}`}>
                                <span className={`trade-action ${t.action}`}>{t.action.toUpperCase()}</span>
                                <span className="trade-symbol">{t.symbol}</span>
                                <span className="trade-amount">{t.amount.toFixed(4)}</span>
                                <span className="trade-usd">${t.amountUsd.toFixed(2)}</span>
                                <span className="trade-protocol">{t.protocol}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function StrategiesTab({ model }: { model: FlashLoanViewModel }) {
    const strategies = useAtomValue(model.strategies);
    const [selectedId, setSelectedId] = useAtom(model.selectedStrategyId);
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    const selected = strategies.find((s) => s.id === selectedId);

    return (
        <div className="widget-tab-content">
            <div className="strategies-list">
                {strategies.map((strat) => (
                    <div
                        key={strat.id}
                        className={`strategy-card risk-${strat.riskLevel} ${selectedId === strat.id ? "selected" : ""}`}
                        onClick={() => setSelectedId(strat.id)}
                    >
                        <div className="strat-top">
                            <span className="strat-name">{strat.name}</span>
                            <span className={`risk-badge risk-${strat.riskLevel}`}>{strat.riskLevel.toUpperCase()}</span>
                        </div>
                        <div className="strat-desc">{strat.description}</div>
                        <div className="strat-metrics">
                            <div className="strat-metric">
                                <span className="smet-label">Flash Loan</span>
                                <span className="smet-val">{strat.loanAmount.toLocaleString()} {strat.loanToken}</span>
                            </div>
                            <div className="strat-metric">
                                <span className="smet-label">Expected Profit</span>
                                <span className="smet-val positive">${strat.netProfit.toFixed(2)}</span>
                            </div>
                            <div className="strat-metric">
                                <span className="smet-label">Est. APY</span>
                                <span className="smet-val positive">{strat.apy.toFixed(1)}%</span>
                            </div>
                            <div className="strat-metric">
                                <span className="smet-label">Gas</span>
                                <span className="smet-val">~${strat.gasEstimate.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="strat-protocol">Protocol: {strat.protocol}</div>
                    </div>
                ))}
            </div>

            {selected && (
                <div className="flash-section">
                    <div className="flash-section-header">Execution Steps — {selected.name}</div>
                    <div className="exec-steps">
                        {selected.steps.map((step, i) => (
                            <div key={i} className="exec-step">
                                <span className="step-num">{i + 1}</span>
                                <span className="step-text">{step}</span>
                            </div>
                        ))}
                    </div>
                    <button
                        className="simulate-btn"
                        onClick={() => {
                            setActiveTab("simulate");
                            model.runSimulation();
                        }}
                    >
                        ⚡ Run Simulation
                    </button>
                </div>
            )}
        </div>
    );
}

function SimulateTab({ model }: { model: FlashLoanViewModel }) {
    const simResult = useAtomValue(model.simulationResult);
    const isSimulating = useAtomValue(model.isSimulating);
    const strategies = useAtomValue(model.strategies);
    const selectedId = useAtomValue(model.selectedStrategyId);

    const selected = strategies.find((s) => s.id === selectedId);

    return (
        <div className="widget-tab-content">
            <div className="flash-section">
                <div className="flash-section-header">
                    Flash Loan Simulation
                    {selected && <span className="strategy-tag">{selected.name}</span>}
                </div>

                {isSimulating && (
                    <div className="simulating-indicator">
                        <div className="sim-spinner">⟳</div>
                        <span>Simulating transaction...</span>
                    </div>
                )}

                {simResult && !isSimulating && (
                    <div className={`sim-result ${simResult.success ? "success" : "failed"}`}>
                        <div className="sim-result-header">
                            {simResult.success ? "✓ Simulation Successful" : "✗ Simulation Failed"}
                        </div>
                        <div className="sim-metrics">
                            <div className="sim-metric">
                                <span className="sim-mlabel">Start Balance</span>
                                <span className="sim-mval">${simResult.startBalance.toLocaleString()}</span>
                            </div>
                            <div className="sim-metric">
                                <span className="sim-mlabel">End Balance</span>
                                <span className="sim-mval">${simResult.endBalance.toLocaleString()}</span>
                            </div>
                            <div className="sim-metric">
                                <span className="sim-mlabel">Profit</span>
                                <span className={`sim-mval ${simResult.profit > 0 ? "positive" : ""}`}>
                                    ${simResult.profit.toFixed(2)}
                                </span>
                            </div>
                            <div className="sim-metric">
                                <span className="sim-mlabel">Gas Used</span>
                                <span className="sim-mval">${simResult.gasUsed.toFixed(2)}</span>
                            </div>
                            <div className="sim-metric">
                                <span className="sim-mlabel">Execution Time</span>
                                <span className="sim-mval">{simResult.executionTime.toFixed(0)}ms</span>
                            </div>
                        </div>
                        <div className="sim-trace">
                            <div className="trace-header">Execution Trace</div>
                            {simResult.trace.map((line, i) => (
                                <div key={i} className="trace-line">{line}</div>
                            ))}
                        </div>
                    </div>
                )}

                {!simResult && !isSimulating && (
                    <div className="sim-empty">
                        <p>Select a strategy and click "Run Simulation" to test the flash loan execution.</p>
                        <button className="simulate-btn" onClick={() => model.runSimulation()}>
                            ⚡ Run Simulation
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function HistoryTab() {
    return (
        <div className="widget-tab-content">
            <div className="flash-section">
                <div className="flash-section-header">Execution History</div>
                <div className="history-table">
                    <div className="hist-row header">
                        <span>Date</span>
                        <span>Strategy</span>
                        <span>Profit</span>
                        <span>Gas</span>
                        <span>Status</span>
                        <span>Tx</span>
                    </div>
                    <div className="hist-row empty-state">No executions recorded yet</div>
                </div>
            </div>
        </div>
    );
}

export const FlashLoan: React.FC<ViewComponentProps<FlashLoanViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    const tabs = [
        { id: "portfolio" as const, label: "Portfolio" },
        { id: "strategies" as const, label: "Strategies" },
        { id: "simulate" as const, label: "Simulate" },
        { id: "history" as const, label: "History" },
    ];

    return (
        <div className="flashloan-widget">
            <div className="widget-header-bar">
                <div className="widget-title">
                    <span className="widget-icon">⚡</span>
                    <span>Flash Loan Arbitrage Rebalancer</span>
                    <span className="widget-subtitle">Atomic Portfolio Rebalancing</span>
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
                {activeTab === "portfolio" && <PortfolioTab model={model} />}
                {activeTab === "strategies" && <StrategiesTab model={model} />}
                {activeTab === "simulate" && <SimulateTab model={model} />}
                {activeTab === "history" && <HistoryTab />}
            </div>
        </div>
    );
};
