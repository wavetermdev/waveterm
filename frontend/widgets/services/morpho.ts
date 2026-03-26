// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Morpho Blue API client — fetches lending market data via GraphQL.

const MORPHO_API = "https://blue-api.morpho.org/graphql";

export type MorphoMarket = {
    id: string;
    loanToken: { symbol: string; address: string };
    collateralToken: { symbol: string; address: string };
    lltv: number;
    supplyApyPercent: number;
    borrowApyPercent: number;
    totalSupplyUsd: number;
    totalBorrowUsd: number;
    utilizationPct: number;
    chainId: number;
};

type MorphoApiMarket = {
    uniqueKey: string;
    loanAsset: { symbol: string; address: string };
    collateralAsset: { symbol: string; address: string } | null;
    lltv: string;
    state: {
        supplyApy: number;
        borrowApy: number;
        supplyAssetsUsd: number;
        borrowAssetsUsd: number;
        utilization: number;
    } | null;
    morphoBlue: { chain: { id: number } } | null;
};

type MorphoApiResponse = {
    data?: {
        markets?: {
            items?: MorphoApiMarket[];
        };
    };
    errors?: Array<{ message: string }>;
};

const QUERY = `{
  markets(first: 20, orderBy: TotalSupplyUsd, orderDirection: Desc) {
    items {
      uniqueKey
      loanAsset { symbol address }
      collateralAsset { symbol address }
      lltv
      state {
        supplyApy borrowApy
        supplyAssetsUsd borrowAssetsUsd
        utilization
      }
      morphoBlue { chain { id } }
    }
  }
}`;

export async function fetchMorphoMarkets(
    chainId?: number,
    limit: number = 20
): Promise<MorphoMarket[]> {
    try {
        const resp = await fetch(MORPHO_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: QUERY }),
        });
        if (!resp.ok) return [];
        const json = (await resp.json()) as MorphoApiResponse;
        if (json.errors || !json.data?.markets?.items) return [];

        const markets = json.data.markets.items
            .map((m): MorphoMarket => ({
                id: m.uniqueKey,
                loanToken: m.loanAsset,
                collateralToken: m.collateralAsset ?? { symbol: "—", address: "" },
                lltv: parseFloat(m.lltv) || 0,
                supplyApyPercent: (m.state?.supplyApy ?? 0) * 100,
                borrowApyPercent: (m.state?.borrowApy ?? 0) * 100,
                totalSupplyUsd: m.state?.supplyAssetsUsd ?? 0,
                totalBorrowUsd: m.state?.borrowAssetsUsd ?? 0,
                utilizationPct: (m.state?.utilization ?? 0) * 100,
                chainId: m.morphoBlue?.chain?.id ?? 0,
            }))
            .filter((m) => chainId == null || m.chainId === chainId)
            .slice(0, limit);

        return markets;
    } catch {
        return [];
    }
}
