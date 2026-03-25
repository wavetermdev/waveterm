// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Canonical on-chain contract address registry.
//
// All subgraph/price queries that reference protocol contracts must resolve
// addresses through this file.  This is the single source of truth for
// blockchain addresses — no raw strings scattered across widget models.

// ---- Chain IDs -------------------------------------------------------------

export const CHAIN_IDS = {
    ETHEREUM: 1,
    ARBITRUM: 42161,
    ARBITRUM_NOVA: 42170,
    OPTIMISM: 10,
    BASE: 8453,
    POLYGON: 137,
    AVALANCHE: 43114,
    BSC: 56,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// ---- Token addresses -------------------------------------------------------

/** ERC-20 token addresses indexed by chain then by symbol. */
export const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
    [CHAIN_IDS.ARBITRUM]: {
        USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "USDC.e": "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
        ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
        GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
        LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
        MAGIC: "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
        PENDLE: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8",
        UNI: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0",
        RDNT: "0x3082CC23568eA640225c2467653dB90e9250AaA0",
    },
    [CHAIN_IDS.ETHEREUM]: {
        USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
        UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
        LDO: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
        MKR: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
        CRV: "0xD533a949740bb3306d119CC777fa900bA034cd52",
        BAL: "0xba100000625a3754423978a60c9317c58a424e3D",
        SNX: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F",
        COMP: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
        RPL: "0xD33526068D116cE69F19A9ee46F0bd304F21A51f",
    },
};

// ---- Protocol addresses ----------------------------------------------------

/** Aave V3 contracts on each supported chain. */
export const AAVE_V3: Record<number, { poolAddressProvider: string; uiPoolDataProvider: string; pool: string }> = {
    [CHAIN_IDS.ARBITRUM]: {
        poolAddressProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        uiPoolDataProvider: "0x145dE30c929a065582da84Cf96F88460dB9745A7",
        pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    },
    [CHAIN_IDS.ETHEREUM]: {
        poolAddressProvider: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
        uiPoolDataProvider: "0x91c0eA31b49B69Ea18607702c5d9aC360bf3dE7d",
        pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    },
};

/** Uniswap V3 contracts. */
export const UNISWAP_V3: Record<
    number,
    { factory: string; quoterV2: string; swapRouter02: string; nfpm: string; subgraph: string }
> = {
    [CHAIN_IDS.ARBITRUM]: {
        factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        nfpm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        subgraph: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-arbitrum",
    },
    [CHAIN_IDS.ETHEREUM]: {
        factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        nfpm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        subgraph: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3",
    },
};

/** Camelot V3 contracts on Arbitrum. */
export const CAMELOT_V3 = {
    factory: "0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35d",
    quoter: "0xc7B7471f34Ac14D9fE5D8A9b4B71F3303B98f5C2",
    swapRouter: "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18",
    nfpm: "0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD46",
    subgraph: "https://api.thegraph.com/subgraphs/name/camelot-exchange/camelot-v3",
} as const;

/** Balancer V2 contracts. */
export const BALANCER_V2: Record<number, { vault: string; subgraph: string }> = {
    [CHAIN_IDS.ARBITRUM]: {
        vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
        subgraph: "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-arbitrum-v2",
    },
    [CHAIN_IDS.ETHEREUM]: {
        vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
        subgraph: "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2",
    },
};

/** Curve Finance contracts. */
export const CURVE: Record<number, { registry: string; apiUrl: string }> = {
    [CHAIN_IDS.ARBITRUM]: {
        registry: "0x0E9fcea8f6d35C1d918aE2a97C7658e63a8A9C3e",
        apiUrl: "https://api.curve.fi/v1/getPools/arbitrum/main",
    },
    [CHAIN_IDS.ETHEREUM]: {
        registry: "0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f6",
        apiUrl: "https://api.curve.fi/v1/getPools/ethereum/main",
    },
};

/** GMX V2 contracts on Arbitrum. */
export const GMX_V2 = {
    reader: "0x38d91ED96283d62182Fc6d990C24097A918a4d9b",
    dataStore: "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8",
    exchangeRouter: "0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8",
    subgraph: "https://subgraph.satsuma-prod.com/gmx/synthetics-arbitrum-stats/api",
} as const;

/** Hyperliquid — no on-chain addresses (L1 perp DEX), but config constants. */
export const HYPERLIQUID = {
    restApi: "https://api.hyperliquid.xyz/info",
    wsApi: "wss://api.hyperliquid.xyz/ws",
    /** The Hyperliquid L1 bridge on Arbitrum. */
    bridgeArbitrum: "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7",
} as const;

// ---- Helpers ---------------------------------------------------------------

/** Look up a token address on a given chain; returns null if unknown. */
export function getTokenAddress(symbol: string, chainId: number = CHAIN_IDS.ARBITRUM): string | null {
    return TOKEN_ADDRESSES[chainId]?.[symbol.toUpperCase()] ?? null;
}

/** Build a block-explorer URL for a given address on a chain. */
export function explorerUrl(address: string, chainId: number = CHAIN_IDS.ARBITRUM): string {
    const explorers: Record<number, string> = {
        [CHAIN_IDS.ARBITRUM]: "https://arbiscan.io/address",
        [CHAIN_IDS.ETHEREUM]: "https://etherscan.io/address",
        [CHAIN_IDS.OPTIMISM]: "https://optimistic.etherscan.io/address",
        [CHAIN_IDS.BASE]: "https://basescan.org/address",
        [CHAIN_IDS.POLYGON]: "https://polygonscan.com/address",
        [CHAIN_IDS.AVALANCHE]: "https://snowtrace.io/address",
        [CHAIN_IDS.BSC]: "https://bscscan.com/address",
    };
    const base = explorers[chainId] ?? "https://arbiscan.io/address";
    return `${base}/${address}`;
}
