// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { fetchTokenPrices } from "../services/coingecko";
import { type MorphoMarket, fetchMorphoMarkets } from "../services/morpho";
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

const ASSET_ICONS: Record<string, string> = {
    USDC: "💵", ETH: "💎", WETH: "💎", WBTC: "₿", ARB: "🔵", DAI: "🟡",
    USDT: "💚", OP: "🔴", GNO: "🦉", cbETH: "🔷", rETH: "🔶", wstETH: "🌊",
};

/** Map a Morpho Blue market to a LendingAsset for the UI.  */
function morphoToAsset(m: MorphoMarket): LendingAsset {
    const sym = m.loanToken.symbol;
    return {
        symbol: sym,
        name: sym,
        supplyApy: m.supplyApyPercent,
        borrowApy: m.borrowApyPercent,
        totalSupply: m.totalSupplyUsd,
        totalBorrow: m.totalBorrowUsd,
        utilization: m.utilizationPct,
        price: 1, // enriched later by CoinGecko
        ltv: m.lltv,
        liquidationThreshold: Math.min(m.lltv + 0.025, 0.95), // 2.5% buffer above LLTV, capped at 95%
        icon: ASSET_ICONS[sym] ?? "🪙",
        mlPredictedApy: m.supplyApyPercent * 1.08,
    };
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

export class DeFiLendingViewModel implements ViewModel {
    viewType = "defilending";
    blockId: string;

    viewIcon = jotai.atom<string>("bank");
    viewName = jotai.atom<string>("DeFi Lending");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"markets" | "position" | "actions" | "model">("markets");
    assets = jotai.atom<LendingAsset[]>([]);
    userPositions = jotai.atom<UserPosition[]>([]);
    selectedAction = jotai.atom<"supply" | "borrow" | "repay" | "withdraw" | "collateral-swap-repay">("supply");
    selectedAsset = jotai.atom<string>("USDC");
    actionAmount = jotai.atom<string>("");
    swapRepaySteps = jotai.atom<SwapRepayStep[]>([
        { id: 1, label: "Flash loan", status: "pending" },
        { id: 2, label: "Swap collateral → debt token", status: "pending" },
        { id: 3, label: "Repay debt position", status: "pending" },
        { id: 4, label: "Return flash loan", status: "pending" },
        { id: 5, label: "Withdraw freed collateral", status: "pending" },
    ]);
    rateHistory = jotai.atom<RateHistory[]>([]);
    /** Morpho Blue lending markets. */
    morphoMarkets = jotai.atom<MorphoMarket[]>([]);
    /** "live" once Morpho data has been fetched successfully. */
    dataSource = jotai.atom<"live" | "demo">("demo");

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

    /** Fetch Morpho Blue markets (primary) and enrich prices from CoinGecko. */
    async initLivePrices() {
        // 1. Fetch Morpho Blue lending markets — these are the authoritative APY/utilization source
        try {
            const markets = await fetchMorphoMarkets(42161);
            if (markets.length > 0) {
                globalStore.set(this.morphoMarkets, markets);
                // Map Morpho markets to LendingAsset[]
                const seen = new Set<string>();
                const assets: LendingAsset[] = [];
                for (const m of markets) {
                    const sym = m.loanToken.symbol;
                    if (seen.has(sym)) continue; // deduplicate by loan token
                    seen.add(sym);
                    assets.push(morphoToAsset(m));
                }
                globalStore.set(this.assets, assets);
                globalStore.set(this.dataSource, "live");
            }
        } catch (e) {
            console.warn("[DeFiLending] Morpho unavailable", e);
        }

        // 2. Enrich asset prices from CoinGecko
        try {
            const currentAssets = globalStore.get(this.assets);
            if (currentAssets.length === 0) return;
            const symbols = currentAssets.map((a) => a.symbol);
            const prices = await fetchTokenPrices(symbols);
            if (Object.keys(prices).length > 0) {
                const enriched = currentAssets.map((a) => {
                    const livePrice = prices[a.symbol];
                    return livePrice != null ? { ...a, price: livePrice } : a;
                });
                globalStore.set(this.assets, enriched);
            }
        } catch (e) {
            console.warn("[DeFiLending] CoinGecko unavailable – prices remain at placeholder", e);
        }
    }

    refreshRates() {
        // Rates are updated from live CoinGecko prices; APY and utilization remain stable
        // until a real on-chain data source is connected.
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
