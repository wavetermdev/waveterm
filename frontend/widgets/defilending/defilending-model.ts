// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { fetchTokenPrices } from "../services/coingecko";
import { DeFiLending } from "./defilending";

export type LendingAsset = {
    symbol: string;
    name: string;
    supplyApy: number;
    borrowApy: number;
    totalSupply: number;
    totalBorrow: number;
    utilization: number;
    price: number;
    ltv: number; // loan-to-value ratio
    liquidationThreshold: number;
    icon: string;
    mlPredictedApy: number;
};

export type UserPosition = {
    symbol: string;
    supplied: number;
    borrowed: number;
    collateralEnabled: boolean;
};

export type HealthData = {
    healthFactor: number;
    netApy: number;
    totalCollateral: number;
    totalBorrow: number;
    availableToBorrow: number;
};

export type SwapRepayStep = {
    id: number;
    label: string;
    status: "pending" | "active" | "done" | "error";
    txHash?: string;
};

export type RateHistory = {
    ts: number;
    supplyApy: number;
    borrowApy: number;
    utilization: number;
};

function generateAssets(): LendingAsset[] {
    return [
        {
            symbol: "USDC",
            name: "USD Coin",
            supplyApy: 4.82,
            borrowApy: 7.14,
            totalSupply: 184500000,
            totalBorrow: 127300000,
            utilization: 69.0,
            price: 1.0,
            ltv: 0.87,
            liquidationThreshold: 0.9,
            icon: "💵",
            mlPredictedApy: 5.1,
        },
        {
            symbol: "ETH",
            name: "Ethereum",
            supplyApy: 2.14,
            borrowApy: 3.87,
            totalSupply: 48200,
            totalBorrow: 29100,
            utilization: 60.4,
            price: 3520,
            ltv: 0.8,
            liquidationThreshold: 0.825,
            icon: "💎",
            mlPredictedApy: 2.45,
        },
        {
            symbol: "WBTC",
            name: "Wrapped Bitcoin",
            supplyApy: 0.48,
            borrowApy: 2.15,
            totalSupply: 2840,
            totalBorrow: 1120,
            utilization: 39.4,
            price: 67450,
            ltv: 0.7,
            liquidationThreshold: 0.75,
            icon: "₿",
            mlPredictedApy: 0.62,
        },
        {
            symbol: "ARB",
            name: "Arbitrum",
            supplyApy: 6.34,
            borrowApy: 11.2,
            totalSupply: 45200000,
            totalBorrow: 32100000,
            utilization: 71.0,
            price: 1.24,
            ltv: 0.65,
            liquidationThreshold: 0.7,
            icon: "🔵",
            mlPredictedApy: 7.2,
        },
        {
            symbol: "DAI",
            name: "Dai Stablecoin",
            supplyApy: 4.41,
            borrowApy: 6.89,
            totalSupply: 98700000,
            totalBorrow: 67400000,
            utilization: 68.3,
            price: 1.0,
            ltv: 0.86,
            liquidationThreshold: 0.88,
            icon: "🟡",
            mlPredictedApy: 4.8,
        },
    ];
}

function generateUserPosition(): UserPosition[] {
    return [
        { symbol: "USDC", supplied: 10000, borrowed: 0, collateralEnabled: true },
        { symbol: "ETH", supplied: 2.5, borrowed: 0.8, collateralEnabled: true },
        { symbol: "WBTC", supplied: 0, borrowed: 0, collateralEnabled: false },
        { symbol: "ARB", supplied: 5000, borrowed: 2000, collateralEnabled: true },
        { symbol: "DAI", supplied: 0, borrowed: 3500, collateralEnabled: false },
    ];
}

function calcHealthData(positions: UserPosition[], assets: LendingAsset[]): HealthData {
    let totalCollateral = 0;
    let totalBorrow = 0;
    let supplyYield = 0;
    let borrowCost = 0;
    let weightedLiqThreshold = 0;

    positions.forEach((pos) => {
        const asset = assets.find((a) => a.symbol === pos.symbol);
        if (!asset) return;
        const suppliedUsd = pos.supplied * asset.price;
        const borrowedUsd = pos.borrowed * asset.price;
        if (pos.collateralEnabled) {
            totalCollateral += suppliedUsd;
            weightedLiqThreshold += suppliedUsd * asset.liquidationThreshold;
        }
        totalBorrow += borrowedUsd;
        supplyYield += suppliedUsd * asset.supplyApy;
        borrowCost += borrowedUsd * asset.borrowApy;
    });

    const avgThreshold = totalCollateral > 0 ? weightedLiqThreshold / totalCollateral : 0;
    const healthFactor = totalBorrow > 0 ? (totalCollateral * avgThreshold) / totalBorrow : 999;
    const netApy = totalCollateral > 0 ? (supplyYield - borrowCost) / totalCollateral : 0;
    const availableToBorrow = totalCollateral * 0.8 - totalBorrow;

    return {
        healthFactor: Math.max(0, healthFactor),
        netApy,
        totalCollateral,
        totalBorrow,
        availableToBorrow: Math.max(0, availableToBorrow),
    };
}

function generateRateHistory(baseSupply: number, baseBorrow: number, count = 48): RateHistory[] {
    const now = Date.now();
    const history: RateHistory[] = [];
    let supply = baseSupply;
    let borrow = baseBorrow;
    let util = 65 + Math.random() * 15;
    for (let i = count; i >= 0; i--) {
        supply += (Math.random() - 0.5) * 0.2;
        borrow += (Math.random() - 0.5) * 0.2;
        util += (Math.random() - 0.5) * 2;
        util = Math.max(30, Math.min(95, util));
        history.push({
            ts: now - i * 3600000,
            supplyApy: Math.max(0.1, supply),
            borrowApy: Math.max(supply + 0.5, borrow),
            utilization: util,
        });
    }
    return history;
}

export class DeFiLendingViewModel implements ViewModel {
    viewType = "defilending";
    blockId: string;

    viewIcon = jotai.atom<string>("bank");
    viewName = jotai.atom<string>("DeFi Lending");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"markets" | "position" | "actions" | "model">("markets");
    assets = jotai.atom<LendingAsset[]>(generateAssets());
    userPositions = jotai.atom<UserPosition[]>(generateUserPosition());
    selectedAction = jotai.atom<"supply" | "borrow" | "repay" | "withdraw" | "collateral-swap-repay">("supply");
    selectedAsset = jotai.atom<string>("USDC");
    actionAmount = jotai.atom<string>("");
    swapRepaySteps = jotai.atom<SwapRepayStep[]>([
        { id: 1, label: "Flash loan USDC", status: "done", txHash: "0xabc...123" },
        { id: 2, label: "Swap collateral → debt token", status: "done", txHash: "0xdef...456" },
        { id: 3, label: "Repay debt position", status: "active" },
        { id: 4, label: "Return flash loan", status: "pending" },
        { id: 5, label: "Withdraw freed collateral", status: "pending" },
    ]);
    rateHistory = jotai.atom<RateHistory[]>(generateRateHistory(4.82, 7.14));

    healthData: jotai.Atom<HealthData>;
    viewText: jotai.Atom<HeaderElem[]>;

    private refreshInterval: ReturnType<typeof setInterval> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;

        this.healthData = jotai.atom((get) => {
            const positions = get(this.userPositions);
            const assets = get(this.assets);
            return calcHealthData(positions, assets);
        });

        this.viewText = jotai.atom((get) => {
            const health = get(this.healthData);
            const hf = health.healthFactor;
            const hfColor = hf < 1.1 ? "negative" : hf < 1.5 ? "warning" : "positive";
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `HF: ${hf > 100 ? "∞" : hf.toFixed(2)}`,
                    className: `widget-health-${hfColor}`,
                    noGrow: true,
                },
                {
                    elemtype: "text",
                    text: `Net APY: ${health.netApy.toFixed(2)}%`,
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: "rotate-right",
                    title: "Refresh rates",
                    click: () => this.refreshRates(),
                },
            ];
            return elems;
        });

        // Try to fetch real token prices on load
        void this.initLivePrices();
        this.startRefresh();
    }

    get viewComponent(): ViewComponent {
        return DeFiLending as ViewComponent;
    }

    /** Update asset prices from CoinGecko, keeping APY rates as-is until Aave data is wired. */
    async initLivePrices() {
        try {
            const symbols = globalStore.get(this.assets).map((a) => a.symbol);
            const prices = await fetchTokenPrices(symbols);
            if (Object.keys(prices).length === 0) return;
            const updated = globalStore.get(this.assets).map((a) => {
                const livePrice = prices[a.symbol];
                return livePrice != null ? { ...a, price: livePrice } : a;
            });
            globalStore.set(this.assets, updated);
        } catch (e) {
            console.warn("[DeFiLending] CoinGecko unavailable – using mock prices", e);
        }
    }

    refreshRates() {
        const current = globalStore.get(this.assets);
        const updated = current.map((a) => ({
            ...a,
            supplyApy: Math.max(0.1, a.supplyApy + (Math.random() - 0.5) * 0.3),
            borrowApy: Math.max(a.supplyApy + 0.5, a.borrowApy + (Math.random() - 0.5) * 0.3),
            utilization: Math.max(20, Math.min(98, a.utilization + (Math.random() - 0.5) * 3)),
        }));
        globalStore.set(this.assets, updated);
    }

    startRefresh() {
        // Refresh APY rates every 10 s; re-fetch live prices every 60 s
        let tick = 0;
        this.refreshInterval = setInterval(() => {
            this.refreshRates();
            tick++;
            if (tick % 6 === 0) void this.initLivePrices();
        }, 10000);
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
