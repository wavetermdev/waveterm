// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave Terminal Financial/DeFi + Platform Widgets
// All widgets live in this separate directory and do not modify original repository files.
// Widgets are registered in the BlockRegistry via a single import in block.tsx.
//
// View types (open with: wsh view <viewType>):
//  - tradingalgobot  : Trading Algobot (Hyperliquid API + ONNX/Joblib ML)
//  - arbitragebot    : Triangular Arbitrage Bot (Arbitrum + ML)
//  - defilending     : DeFi Lending (Supply/Borrow/CollateralizedSwapRepay + ML)
//  - flashloan       : Flash Loan Arbitrage Portfolio Rebalancer
//  - ammliquidity    : AMM Liquidity Pools (Uniswap V3, Camelot, Curve, Balancer)
//  - codeeditor      : AI-Assisted Code Editor (multi-language + autocompletion)
//  - containers      : Container Manager (Docker/K8s)
//  - shellworkflow   : Shell Programmable Workflows (button-triggered pipelines)
//  - mlmodel         : ML Model Training/Eval/Retrain (GBM/LR/NN/RF/NumpyLogistics + ONNX/Joblib)
//  - widgetbuilder   : Custom Widget Builder (AI chat + storage + DB query + HTTP)

import { AmmLiquidityViewModel } from "./ammliquidity/ammliquidity-model";
import { ArbitrageBotViewModel } from "./arbitragebot/arbitragebot-model";
import { CodeEditorViewModel } from "./codeeditor/codeeditor-model";
import { ContainerManagerViewModel } from "./containers/containers-model";
import { DeFiLendingViewModel } from "./defilending/defilending-model";
import { FlashLoanViewModel } from "./flashloan/flashloan-model";
import { MLModelViewModel } from "./mlmodel/mlmodel-model";
import { ShellWorkflowViewModel } from "./shellworkflow/shellworkflow-model";
import { TradingAlgoBotViewModel } from "./tradingalgobot/tradingalgobot-model";
import { WidgetBuilderViewModel } from "./widgetbuilder/widgetbuilder-model";

export { AmmLiquidityViewModel } from "./ammliquidity/ammliquidity-model";
export { ArbitrageBotViewModel } from "./arbitragebot/arbitragebot-model";
export { CodeEditorViewModel } from "./codeeditor/codeeditor-model";
export { ContainerManagerViewModel } from "./containers/containers-model";
export { DeFiLendingViewModel } from "./defilending/defilending-model";
export { FlashLoanViewModel } from "./flashloan/flashloan-model";
export { MLModelViewModel } from "./mlmodel/mlmodel-model";
export { ShellWorkflowViewModel } from "./shellworkflow/shellworkflow-model";
export { TradingAlgoBotViewModel } from "./tradingalgobot/tradingalgobot-model";
export { WidgetBuilderViewModel } from "./widgetbuilder/widgetbuilder-model";

export const WIDGET_REGISTRY_ENTRIES: Array<[string, ViewModelClass]> = [
    ["tradingalgobot", TradingAlgoBotViewModel as unknown as ViewModelClass],
    ["arbitragebot", ArbitrageBotViewModel as unknown as ViewModelClass],
    ["defilending", DeFiLendingViewModel as unknown as ViewModelClass],
    ["flashloan", FlashLoanViewModel as unknown as ViewModelClass],
    ["ammliquidity", AmmLiquidityViewModel as unknown as ViewModelClass],
    ["codeeditor", CodeEditorViewModel as unknown as ViewModelClass],
    ["containers", ContainerManagerViewModel as unknown as ViewModelClass],
    ["shellworkflow", ShellWorkflowViewModel as unknown as ViewModelClass],
    ["mlmodel", MLModelViewModel as unknown as ViewModelClass],
    ["widgetbuilder", WidgetBuilderViewModel as unknown as ViewModelClass],
];
