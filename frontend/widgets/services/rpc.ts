// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// On-chain price reads via eth_call — no external library dependencies.
// Implements a compact keccak256 in pure TypeScript using BigInt so that
// ABI function selectors can be computed at runtime.

// ---- Keccak-f[1600] --------------------------------------------------------

const KECCAK_RC: bigint[] = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const RHO: number[] = [1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const PI: number[] = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

const MASK64 = 0xffffffffffffffffn;

function rotl64(x: bigint, n: number): bigint {
    return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}

function keccakF(state: bigint[]): void {
    for (let round = 0; round < 24; round++) {
        // θ
        const C: bigint[] = Array.from({ length: 5 }, (_, x) =>
            state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
        );
        const D: bigint[] = Array.from({ length: 5 }, (_, x) =>
            C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1)
        );
        for (let i = 0; i < 25; i++) state[i] ^= D[i % 5];

        // ρ + π
        const B: bigint[] = new Array<bigint>(25).fill(0n);
        B[0] = state[0];
        let lane = 1;
        for (let i = 0; i < 24; i++) {
            const next = PI[i];
            B[next] = rotl64(state[lane], RHO[i]);
            lane = next;
        }

        // χ
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
                state[y * 5 + x] = B[y * 5 + x] ^ (~B[y * 5 + ((x + 1) % 5)] & B[y * 5 + ((x + 2) % 5)]);
            }
        }

        // ι
        state[0] ^= KECCAK_RC[round];
    }
}

function keccak256(data: Uint8Array): Uint8Array {
    const RATE = 136; // 17 lanes × 8 bytes for keccak-256
    const state: bigint[] = new Array<bigint>(25).fill(0n);

    // Padding: append 0x01, pad to RATE, set MSB of last padding byte
    const padded = new Uint8Array(Math.ceil((data.length + 1) / RATE) * RATE);
    padded.set(data);
    padded[data.length] = 0x01;
    padded[padded.length - 1] |= 0x80;

    // Absorb
    for (let offset = 0; offset < padded.length; offset += RATE) {
        for (let i = 0; i < 17; i++) {
            let lane = 0n;
            for (let b = 0; b < 8; b++) {
                lane |= BigInt(padded[offset + i * 8 + b]) << BigInt(b * 8);
            }
            state[i] ^= lane;
        }
        keccakF(state);
    }

    // Squeeze 32 bytes (4 lanes)
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
        for (let b = 0; b < 8; b++) {
            out[i * 8 + b] = Number((state[i] >> BigInt(b * 8)) & 0xffn);
        }
    }
    return out;
}

function textToBytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

function bytesToHex(b: Uint8Array): string {
    return Array.from(b)
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
}

/** Compute the 4-byte ABI selector for a function signature string. */
function selector(sig: string): string {
    return bytesToHex(keccak256(textToBytes(sig))).slice(0, 8);
}

// ---- Hardcoded selectors (canonical) ---------------------------------------

const SEL_GET_RESERVES = "0x0902f1ac";
const SEL_TOKEN0 = "0x0dfe1681";
const SEL_TOKEN1 = "0xd21220a7";
const SEL_SLOT0 = "0x3850c7bd";

// Computed at module load (no network, no external deps)
const SEL_GET_MIN_PRICE = "0x" + selector("getMinPrice(address)");
const SEL_GET_MAX_PRICE = "0x" + selector("getMaxPrice(address)");
const SEL_GET_POOL_TOKENS = "0x" + selector("getPoolTokens(bytes32)");
const SEL_CALCULATE_SWAP = "0x" + selector("calculateSwap(uint8,uint8,uint256)");

// ---- RPC URLs --------------------------------------------------------------

const ARB_RPC = "https://arb1.arbitrum.io/rpc";
const POLYGON_RPC = "https://polygon-rpc.com";

// ---- ABI helpers -----------------------------------------------------------

export function abiEncodeAddress(addr: string): string {
    return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function abiEncodeBytes32(value: string): string {
    return value.replace(/^0x/, "").padEnd(64, "0");
}

export function abiDecodeUint256(hex: string): bigint {
    const clean = hex.replace(/^0x/, "").slice(0, 64);
    return BigInt("0x" + clean);
}

export function abiDecodeUint256Array(hex: string): bigint[] {
    // getReserves returns (uint112,uint112,uint32) packed into two 32-byte slots
    const clean = hex.replace(/^0x/, "");
    const results: bigint[] = [];
    for (let i = 0; i + 64 <= clean.length; i += 64) {
        results.push(BigInt("0x" + clean.slice(i, i + 64)));
    }
    return results;
}

// ---- Core eth_call ---------------------------------------------------------

export async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
    const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
    });
    const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
    if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
    const json = (await resp.json()) as { result?: string; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    if (!json.result) throw new Error("RPC returned empty result");
    return json.result;
}

// ---- GMX V1 price reads ----------------------------------------------------

const GMX_V1_VAULT = "0x489ee077994B6658eAfA855C308275EAd8097C4E";

export async function readGmxV1Price(
    tokenAddress: string
): Promise<{ min: number; max: number } | null> {
    try {
        const encoded = abiEncodeAddress(tokenAddress);
        const [minHex, maxHex] = await Promise.all([
            ethCall(ARB_RPC, GMX_V1_VAULT, SEL_GET_MIN_PRICE + encoded),
            ethCall(ARB_RPC, GMX_V1_VAULT, SEL_GET_MAX_PRICE + encoded),
        ]);
        const min = Number(abiDecodeUint256(minHex)) / 1e30;
        const max = Number(abiDecodeUint256(maxHex)) / 1e30;
        return { min, max };
    } catch {
        return null;
    }
}

// ---- Uniswap V2 / DFYN pair reserve reads ----------------------------------

export async function readV2PairPrice(
    pairAddress: string,
    token0Decimals: number,
    token1Decimals: number,
    rpcUrl: string
): Promise<number | null> {
    try {
        const hex = await ethCall(rpcUrl, pairAddress, SEL_GET_RESERVES);
        const parts = abiDecodeUint256Array(hex);
        if (parts.length < 2) return null;
        const reserve0 = Number(parts[0]) / 10 ** token0Decimals;
        const reserve1 = Number(parts[1]) / 10 ** token1Decimals;
        if (reserve0 === 0) return null;
        return reserve1 / reserve0;
    } catch {
        return null;
    }
}

// Alias used by arbitragebot-model
export const readV2PairReserves = readV2PairPrice;

// ---- Balancer V2 pool token reads ------------------------------------------

const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export async function readBalancerPoolTokens(
    poolId: string,
    rpcUrl: string = ARB_RPC
): Promise<{ tokens: string[]; balances: bigint[] } | null> {
    try {
        const encoded = abiEncodeBytes32(poolId);
        const hex = await ethCall(rpcUrl, BALANCER_VAULT, SEL_GET_POOL_TOKENS + encoded);
        const clean = hex.replace(/^0x/, "");
        // Response: offset_tokens, offset_balances, lastChangeBlock, then arrays
        // Each offset is a uint256 (64 hex chars); parse the dynamic arrays
        const offsetTokensWords = parseInt(clean.slice(0, 64), 16);
        const offsetBalancesWords = parseInt(clean.slice(64, 128), 16);
        const tokensOffset = offsetTokensWords * 2;
        const balancesOffset = offsetBalancesWords * 2;
        const tokensLen = parseInt(clean.slice(tokensOffset, tokensOffset + 64), 16);
        const balancesLen = parseInt(clean.slice(balancesOffset, balancesOffset + 64), 16);
        const tokens: string[] = [];
        const balances: bigint[] = [];
        for (let i = 0; i < tokensLen; i++) {
            const start = tokensOffset + 64 + i * 64;
            tokens.push("0x" + clean.slice(start + 24, start + 64));
        }
        for (let i = 0; i < balancesLen; i++) {
            const start = balancesOffset + 64 + i * 64;
            balances.push(BigInt("0x" + clean.slice(start, start + 64)));
        }
        return { tokens, balances };
    } catch {
        return null;
    }
}

// ---- Hop Protocol AMM price ------------------------------------------------

export async function readHopAmmPrice(
    poolAddress: string,
    tokenIn: number,
    amountIn: bigint,
    rpcUrl: string = ARB_RPC
): Promise<bigint | null> {
    try {
        const tokenInHex = tokenIn.toString(16).padStart(64, "0");
        const tokenOutHex = (1 - tokenIn).toString(16).padStart(64, "0");
        const amountHex = amountIn.toString(16).padStart(64, "0");
        const data = SEL_CALCULATE_SWAP + tokenInHex + tokenOutHex + amountHex;
        const hex = await ethCall(rpcUrl, poolAddress, data);
        return abiDecodeUint256(hex);
    } catch {
        return null;
    }
}

export { SEL_GET_RESERVES, SEL_TOKEN0, SEL_TOKEN1, SEL_SLOT0 };
