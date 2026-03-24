// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave Terminal Financial/DeFi Widgets
// All widgets live in this separate directory and do not modify original repository files.
// Widgets are registered in the BlockRegistry via a single import in block.tsx.
//
// View types (open with: wsh view <viewType>):
//  - tradingalgobot  : Trading Algobot (Hyperliquid API + ONNX/Joblib ML)
//  - arbitragebot    : Triangular Arbitrage Bot (Arbitrum + ML)
//  - defilending     : DeFi Lending (Supply/Borrow/CollateralizedSwapRepay + ML)
//  - flashloan       : Flash Loan Arbitrage Portfolio Rebalancer
//  - ammliquidity    : AMM Liquidity Pools (Uniswap V3, Camelot, Curve, Balancer)

import { AmmLiquidityViewModel } from "./ammliquidity/ammliquidity-model";
import { ArbitrageBotViewModel } from "./arbitragebot/arbitragebot-model";
import { DeFiLendingViewModel } from "./defilending/defilending-model";
import { FlashLoanViewModel } from "./flashloan/flashloan-model";
import { TradingAlgoBotViewModel } from "./tradingalgobot/tradingalgobot-model";

export { AmmLiquidityViewModel } from "./ammliquidity/ammliquidity-model";
export { ArbitrageBotViewModel } from "./arbitragebot/arbitragebot-model";
export { DeFiLendingViewModel } from "./defilending/defilending-model";
export { FlashLoanViewModel } from "./flashloan/flashloan-model";
export { TradingAlgoBotViewModel } from "./tradingalgobot/tradingalgobot-model";

export const WIDGET_REGISTRY_ENTRIES: Array<[string, ViewModelClass]> = [
    ["tradingalgobot", TradingAlgoBotViewModel as unknown as ViewModelClass],
    ["arbitragebot", ArbitrageBotViewModel as unknown as ViewModelClass],
    ["defilending", DeFiLendingViewModel as unknown as ViewModelClass],
    ["flashloan", FlashLoanViewModel as unknown as ViewModelClass],
    ["ammliquidity", AmmLiquidityViewModel as unknown as ViewModelClass],
];
