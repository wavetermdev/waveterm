// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { AmmLiquidityViewModel, LiquidityPool } from "./ammliquidity-model";
import "./ammliquidity.scss";

function ProtocolBadge({ protocol }: { protocol: string }) {
    const colors: Record<string, string> = {
        "Uniswap V3": "#ff007a",
        Camelot: "#f59e0b",
        Curve: "#ef4444",
        Balancer: "#3b82f6",
        SushiSwap: "#8b5cf6",
    };
    return (
        <span className="protocol-badge" style={{ borderColor: colors[protocol] ?? "#6366f1", color: colors[protocol] ?? "#a5b4fc" }}>
            {protocol}
        </span>
    );
}

function TokenIcon({ icon, symbol }: { icon: string; symbol: string }) {
    if (icon.startsWith("http")) {
        return <img className="token-icon-img" src={icon} alt={symbol} width={18} height={18} />;
    }
    return <span className="token-icon-emoji">{icon || symbol.slice(0, 1)}</span>;
}

function PoolCard({ pool, selected, onClick }: { pool: LiquidityPool; selected?: boolean; onClick?: () => void }) {
    return (
        <div className={`pool-card ${selected ? "selected" : ""}`} onClick={onClick}>
            <div className="pool-top">
                <div className="pool-pair">
                    <TokenIcon icon={pool.icon0} symbol={pool.token0} />
                    <TokenIcon icon={pool.icon1} symbol={pool.token1} />
                    <span className="pair-label">
                        {pool.token0}/{pool.token1}
                    </span>
                    <span className="fee-chip">{pool.fee}%</span>
                </div>
                <ProtocolBadge protocol={pool.protocol} />
            </div>
            <div className="pool-metrics">
                <div className="pool-metric">
                    <span className="pm-label">TVL</span>
                    <span className="pm-val">${(pool.tvl / 1e6).toFixed(1)}M</span>
                </div>
                <div className="pool-metric">
                    <span className="pm-label">Vol 24h</span>
                    <span className="pm-val">${(pool.volume24h / 1e6).toFixed(1)}M</span>
                </div>
                <div className="pool-metric">
                    <span className="pm-label">APY</span>
                    <span className="pm-val positive">{pool.apy.toFixed(1)}%</span>
                </div>
                <div className="pool-metric">
                    <span className="pm-label">Fees 24h</span>
                    <span className="pm-val positive">${(pool.feesEarned24h / 1000).toFixed(1)}K</span>
                </div>
            </div>
        </div>
    );
}

function PoolsTab({ model }: { model: AmmLiquidityViewModel }) {
    const pools = useAtomValue(model.pools);
    const [selectedId, setSelectedId] = useAtom(model.selectedPoolId);

    return (
        <div className="widget-tab-content">
            <div className="pools-list">
                {pools.map((pool) => (
                    <PoolCard
                        key={pool.id}
                        pool={pool}
                        selected={selectedId === pool.id}
                        onClick={() => setSelectedId(pool.id)}
                    />
                ))}
            </div>
        </div>
    );
}

function PositionsTab({ model }: { model: AmmLiquidityViewModel }) {
    const positions = useAtomValue(model.userPositions);
    const pools = useAtomValue(model.pools);
    const stats = useAtomValue(model.poolStats);

    return (
        <div className="widget-tab-content">
            <div className="pos-stats">
                <div className="pos-stat">
                    <div className="ps-label">Total LP Value</div>
                    <div className="ps-val">${stats.totalTvl.toLocaleString()}</div>
                </div>
                <div className="pos-stat">
                    <div className="ps-label">Total Fees Earned</div>
                    <div className="ps-val positive">${stats.totalFeesEarned.toFixed(2)}</div>
                </div>
                <div className="pos-stat">
                    <div className="ps-label">Avg IL</div>
                    <div className={`ps-val ${stats.totalIL <= 0 ? "negative" : "positive"}`}>
                        {stats.totalIL.toFixed(2)}%
                    </div>
                </div>
                <div className="pos-stat">
                    <div className="ps-label">Est. APY</div>
                    <div className="ps-val positive">{stats.avgApy.toFixed(1)}%</div>
                </div>
            </div>

            {positions.map((pos) => {
                const pool = pools.find((p) => p.id === pos.poolId);
                if (!pool) return null;
                const priceChange = ((pool.price - pos.entryPrice) / pos.entryPrice) * 100;
                return (
                    <div key={pos.poolId} className="amm-section">
                        <div className="amm-section-header">
                            {pool.icon0}/{pool.icon1} — {pool.protocol} ({pool.fee}% fee)
                        </div>
                        <div className="position-detail">
                            <div className="pd-row">
                                <span className="pd-label">LP Value</span>
                                <span className="pd-val">${pos.valueUsd.toLocaleString()}</span>
                            </div>
                            <div className="pd-row">
                                <span className="pd-label">{pool.token0} Amount</span>
                                <span className="pd-val">
                                    {pos.token0Amount.toLocaleString()} {pool.token0}
                                </span>
                            </div>
                            <div className="pd-row">
                                <span className="pd-label">{pool.token1} Amount</span>
                                <span className="pd-val">
                                    {pos.token1Amount.toLocaleString()} {pool.token1}
                                </span>
                            </div>
                            <div className="pd-row">
                                <span className="pd-label">Fees Earned</span>
                                <span className="pd-val positive">${pos.feesEarned.toFixed(2)}</span>
                            </div>
                            <div className="pd-row">
                                <span className="pd-label">Impermanent Loss</span>
                                <span className="pd-val negative">{pos.impermanentLoss.toFixed(2)}%</span>
                            </div>
                            <div className="pd-row">
                                <span className="pd-label">Entry Price</span>
                                <span className="pd-val">
                                    {pos.entryPrice.toLocaleString()} {pool.token1}/{pool.token0}
                                </span>
                            </div>
                            <div className="pd-row">
                                <span className="pd-label">Current Price</span>
                                <span className={`pd-val ${priceChange >= 0 ? "positive" : "negative"}`}>
                                    {pool.price.toLocaleString()} {pool.token1}/{pool.token0}
                                    <span className="price-delta">
                                        ({priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%)
                                    </span>
                                </span>
                            </div>
                        </div>
                        <div className="pos-actions">
                            <button className="pos-action-btn collect">Collect Fees</button>
                            <button className="pos-action-btn remove">Remove Liquidity</button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function SwapTab({ model }: { model: AmmLiquidityViewModel }) {
    const pools = useAtomValue(model.pools);
    const [selectedId, setSelectedId] = useAtom(model.selectedPoolId);
    const [inputToken, setInputToken] = useAtom(model.swapInputToken);
    const [inputAmount, setInputAmount] = useAtom(model.swapInputAmount);
    const swapPreview = useAtomValue(model.swapPreview);

    const pool = pools.find((p) => p.id === selectedId);

    return (
        <div className="widget-tab-content">
            <div className="amm-section">
                <div className="amm-section-header">Swap</div>
                <div className="swap-form">
                    <div className="form-field">
                        <label>Pool</label>
                        <select
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                            className="amm-select"
                        >
                            {pools.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.icon0}/{p.icon1} {p.token0}/{p.token1} — {p.protocol} ({p.fee}%)
                                </option>
                            ))}
                        </select>
                    </div>

                    {pool && (
                        <>
                            <div className="form-field">
                                <label>Input Token</label>
                                <div className="token-toggle">
                                    <button
                                        className={`token-btn ${inputToken === pool.token0 ? "active" : ""}`}
                                        onClick={() => setInputToken(pool.token0)}
                                    >
                                        {pool.icon0} {pool.token0}
                                    </button>
                                    <button
                                        className={`token-btn ${inputToken === pool.token1 ? "active" : ""}`}
                                        onClick={() => setInputToken(pool.token1)}
                                    >
                                        {pool.icon1} {pool.token1}
                                    </button>
                                </div>
                            </div>
                            <div className="form-field">
                                <label>Amount</label>
                                <input
                                    type="number"
                                    placeholder="0.00"
                                    value={inputAmount}
                                    onChange={(e) => setInputAmount(e.target.value)}
                                    className="amm-input"
                                />
                            </div>

                            {swapPreview && (
                                <div className="swap-preview">
                                    <div className="preview-row">
                                        <span>Output</span>
                                        <span className="positive">
                                            {swapPreview.outputAmount.toFixed(6)} {swapPreview.outputToken}
                                        </span>
                                    </div>
                                    <div className="preview-row">
                                        <span>Price Impact</span>
                                        <span className={swapPreview.priceImpact > 1 ? "negative" : swapPreview.priceImpact > 0.5 ? "warning" : ""}>
                                            {swapPreview.priceImpact.toFixed(4)}%
                                        </span>
                                    </div>
                                    <div className="preview-row">
                                        <span>Fee ({pool.fee}%)</span>
                                        <span>{swapPreview.fee.toFixed(6)} {swapPreview.inputToken}</span>
                                    </div>
                                    <div className="preview-row">
                                        <span>Effective Price</span>
                                        <span>
                                            {swapPreview.effectivePrice.toFixed(6)}{" "}
                                            {swapPreview.outputToken}/{swapPreview.inputToken}
                                        </span>
                                    </div>
                                </div>
                            )}

                            <button className="swap-execute-btn">Swap {inputToken} → {inputToken === pool.token0 ? pool.token1 : pool.token0}</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function AddLiquidityTab({ model }: { model: AmmLiquidityViewModel }) {
    const pools = useAtomValue(model.pools);
    const [selectedId, setSelectedId] = useAtom(model.selectedPoolId);
    const [amount0, setAmount0] = useAtom(model.addLiquidityToken0);
    const [amount1, setAmount1] = useAtom(model.addLiquidityToken1);

    const pool = pools.find((p) => p.id === selectedId);

    const previewLp = React.useMemo(() => {
        if (!pool || !amount0) return null;
        const a0 = parseFloat(amount0);
        if (isNaN(a0)) return null;
        const a1 = a0 * pool.price;
        const lpShare = (a0 / pool.reserves0) * 100;
        return { a1, lpShare, estimatedApy: pool.apy, feesDaily: (pool.feesEarned24h * lpShare) / 100 };
    }, [pool, amount0]);

    return (
        <div className="widget-tab-content">
            <div className="amm-section">
                <div className="amm-section-header">Add Liquidity</div>
                <div className="add-form">
                    <div className="form-field">
                        <label>Pool</label>
                        <select
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                            className="amm-select"
                        >
                            {pools.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.icon0}/{p.icon1} {p.token0}/{p.token1} — {p.fee}%
                                </option>
                            ))}
                        </select>
                    </div>

                    {pool && (
                        <>
                            <div className="form-field">
                                <label>{pool.icon0} {pool.token0} Amount</label>
                                <input
                                    type="number"
                                    placeholder="0.00"
                                    value={amount0}
                                    onChange={(e) => {
                                        setAmount0(e.target.value);
                                        const a0 = parseFloat(e.target.value);
                                        if (!isNaN(a0)) setAmount1((a0 * pool.price).toFixed(6));
                                    }}
                                    className="amm-input"
                                />
                            </div>
                            <div className="plus-separator">+</div>
                            <div className="form-field">
                                <label>{pool.icon1} {pool.token1} Amount</label>
                                <input
                                    type="number"
                                    placeholder="0.00"
                                    value={amount1}
                                    onChange={(e) => {
                                        setAmount1(e.target.value);
                                        const a1 = parseFloat(e.target.value);
                                        if (!isNaN(a1)) setAmount0((a1 / pool.price).toFixed(6));
                                    }}
                                    className="amm-input"
                                />
                            </div>

                            {previewLp && (
                                <div className="add-preview">
                                    <div className="preview-row">
                                        <span>Pool Share</span>
                                        <span>{previewLp.lpShare.toFixed(4)}%</span>
                                    </div>
                                    <div className="preview-row">
                                        <span>Estimated APY</span>
                                        <span className="positive">{previewLp.estimatedApy.toFixed(1)}%</span>
                                    </div>
                                    <div className="preview-row">
                                        <span>Daily Fees (est.)</span>
                                        <span className="positive">${previewLp.feesDaily.toFixed(2)}</span>
                                    </div>
                                    <div className="preview-row">
                                        <span>Current Price</span>
                                        <span>{pool.price.toLocaleString()} {pool.token1}/{pool.token0}</span>
                                    </div>
                                </div>
                            )}

                            <button className="add-liquidity-btn">Add Liquidity</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export const AmmLiquidity: React.FC<ViewComponentProps<AmmLiquidityViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    const tabs = [
        { id: "pools" as const, label: "Pools" },
        { id: "positions" as const, label: "My Positions" },
        { id: "swap" as const, label: "Swap" },
        { id: "add" as const, label: "Add Liquidity" },
    ];

    return (
        <div className="ammliquidity-widget">
            <div className="widget-header-bar">
                <div className="widget-title">
                    <span className="widget-icon">💧</span>
                    <span>AMM Liquidity Pools</span>
                    <span className="widget-subtitle">Uniswap V3 • Camelot • Curve • Balancer</span>
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
                {activeTab === "pools" && <PoolsTab model={model} />}
                {activeTab === "positions" && <PositionsTab model={model} />}
                {activeTab === "swap" && <SwapTab model={model} />}
                {activeTab === "add" && <AddLiquidityTab model={model} />}
            </div>
        </div>
    );
};
