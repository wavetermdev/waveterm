// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    CancelledError,
    computeSpeedBps,
    createCancelToken,
    DefaultMaxUploadSize,
    downloadPercent,
    formatBytesSize,
    formatDownloadDoneText,
    formatSpeed,
    isDownloadFailure,
    planUploadChunks,
    raceWithCancel,
    readChunkAsBase64,
    reconcileChunkFailure,
    resolveMaxUploadSize,
    uploadPercent,
} from "./preview-model-upload";

const CHUNK = 2 * 1024 * 1024; // 2MB

describe("planUploadChunks", () => {
    it("empty file -> a single zero-length chunk (so the upload still creates the file)", () => {
        expect(planUploadChunks(0, CHUNK)).toEqual([{ offset: 0, length: 0 }]);
    });

    it("file smaller than chunk -> one chunk covering the whole file", () => {
        expect(planUploadChunks(100, CHUNK)).toEqual([{ offset: 0, length: 100 }]);
    });

    it("exact multiple of chunk size -> N equal chunks with contiguous offsets", () => {
        expect(planUploadChunks(4, 2)).toEqual([
            { offset: 0, length: 2 },
            { offset: 2, length: 2 },
        ]);
        expect(planUploadChunks(2 * CHUNK, CHUNK)).toEqual([
            { offset: 0, length: CHUNK },
            { offset: CHUNK, length: CHUNK },
        ]);
    });

    it("remainder -> final chunk is the leftover bytes", () => {
        expect(planUploadChunks(5, 2)).toEqual([
            { offset: 0, length: 2 },
            { offset: 2, length: 2 },
            { offset: 4, length: 1 },
        ]);
    });

    it("single byte file -> one chunk of length 1", () => {
        expect(planUploadChunks(1, CHUNK)).toEqual([{ offset: 0, length: 1 }]);
    });

    it("chunk offsets are contiguous and lengths sum to the file size", () => {
        const fileSize = 5 * CHUNK + 12345;
        const chunks = planUploadChunks(fileSize, CHUNK);
        expect(chunks.length).toBe(6);
        let total = 0;
        let prevEnd = 0;
        for (const chunk of chunks) {
            expect(chunk.offset).toBe(prevEnd);
            expect(chunk.length).toBeGreaterThan(0);
            prevEnd = chunk.offset + chunk.length;
            total += chunk.length;
        }
        expect(total).toBe(fileSize);
        expect(chunks[5]).toEqual({ offset: 5 * CHUNK, length: 12345 });
    });

    it("rejects a non-positive chunkSize", () => {
        expect(() => planUploadChunks(100, 0)).toThrow();
        expect(() => planUploadChunks(100, -1)).toThrow();
    });

    it("rejects a negative or non-finite fileSize", () => {
        expect(() => planUploadChunks(-1, CHUNK)).toThrow();
        expect(() => planUploadChunks(NaN, CHUNK)).toThrow();
    });
});

describe("readChunkAsBase64", () => {
    it("reads and base64-encodes a whole-file chunk", async () => {
        const blob = new Blob([new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])]); // "Hello"
        expect(await readChunkAsBase64(blob, 0, 5)).toBe("SGVsbG8=");
    });

    it("reads a partial chunk at a non-zero offset", async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]);
        expect(await readChunkAsBase64(blob, 2, 3)).toBe("AwQF"); // bytes [3, 4, 5]
    });

    it("a zero-length chunk yields an empty base64 string", async () => {
        const blob = new Blob([new Uint8Array(0)]);
        expect(await readChunkAsBase64(blob, 0, 0)).toBe("");
    });

    it("slices the blob with the exact offset and end", async () => {
        const inner = new Blob([new Uint8Array([10, 20, 30, 40])]);
        const calls: Array<[number, number]> = [];
        const mockBlob = {
            slice(start: number, end: number) {
                calls.push([start, end]);
                return inner.slice(start, end);
            },
        } as unknown as Blob;
        await readChunkAsBase64(mockBlob, 1, 2);
        expect(calls).toEqual([[1, 3]]);
    });
});

describe("computeSpeedBps", () => {
    it("computes bytes per second over the elapsed interval", () => {
        expect(computeSpeedBps(1024, 0, 1000)).toBe(1024);
        expect(computeSpeedBps(100, 1000, 2000)).toBe(100);
    });

    it("returns 0 for zero bytes sent", () => {
        expect(computeSpeedBps(0, 0, 1000)).toBe(0);
    });

    it("returns 0 for zero or negative elapsed time", () => {
        expect(computeSpeedBps(100, 1000, 1000)).toBe(0);
        expect(computeSpeedBps(100, 1000, 500)).toBe(0);
    });

    it("returns 0 for invalid inputs", () => {
        expect(computeSpeedBps(NaN, 0, 1000)).toBe(0);
        expect(computeSpeedBps(-5, 0, 1000)).toBe(0);
    });
});

describe("formatSpeed", () => {
    it("renders zero as 0 B/s", () => {
        expect(formatSpeed(0)).toBe("0 B/s");
    });

    it("renders invalid and negative input as a dash", () => {
        expect(formatSpeed(NaN)).toBe("-");
        expect(formatSpeed(Infinity)).toBe("-");
        expect(formatSpeed(-1)).toBe("-");
    });

    it("keeps sub-1024 rates in bytes", () => {
        expect(formatSpeed(500)).toBe("500 B/s");
    });

    it("scales through kB, MB, and GB with three significant figures", () => {
        expect(formatSpeed(1024)).toBe("1 kB/s");
        expect(formatSpeed(8.2 * 1024 * 1024)).toBe("8.2 MB/s");
        expect(formatSpeed(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB/s");
    });
});

describe("resolveMaxUploadSize", () => {
    const MB = 1024 * 1024;
    const GB = 1024 ** 3;

    it("passes valid values through unchanged", () => {
        expect(resolveMaxUploadSize(DefaultMaxUploadSize)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(500 * MB)).toBe(500 * MB);
        expect(resolveMaxUploadSize(7.5 * GB)).toBe(7.5 * GB);
    });

    it("treats the 3MB floor and 100GB ceiling as inclusive boundaries", () => {
        expect(resolveMaxUploadSize(3 * MB)).toBe(3 * MB);
        expect(resolveMaxUploadSize(100 * GB)).toBe(100 * GB);
    });

    it("falls back to the default for missing/garbage values", () => {
        expect(resolveMaxUploadSize(undefined)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(null)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize("5368709120")).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize({})).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(NaN)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(Infinity)).toBe(DefaultMaxUploadSize);
    });

    it("falls back to the default for zero, negative, and non-integer values", () => {
        expect(resolveMaxUploadSize(0)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(-1)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(3.5)).toBe(DefaultMaxUploadSize);
    });

    it("falls back to the default for out-of-range values", () => {
        expect(resolveMaxUploadSize(3 * MB - 1)).toBe(DefaultMaxUploadSize);
        expect(resolveMaxUploadSize(100 * GB + 1)).toBe(DefaultMaxUploadSize);
    });
});

describe("formatBytesSize", () => {
    it("renders the default 5GB cap as 5GB", () => {
        expect(formatBytesSize(5 * 1024 ** 3)).toBe("5GB");
    });

    it("renders whole-number sizes without a decimal", () => {
        expect(formatBytesSize(500 * 1024 * 1024)).toBe("500MB");
        expect(formatBytesSize(3 * 1024 * 1024)).toBe("3MB");
        expect(formatBytesSize(100 * 1024 ** 3)).toBe("100GB");
    });

    it("renders fractional sizes with three significant figures", () => {
        expect(formatBytesSize(1.5 * 1024 ** 3)).toBe("1.5GB");
    });

    it("renders zero as 0B", () => {
        expect(formatBytesSize(0)).toBe("0B");
    });

    it("renders invalid and negative input as a dash", () => {
        expect(formatBytesSize(NaN)).toBe("-");
        expect(formatBytesSize(-1)).toBe("-");
    });
});

describe("reconcileChunkFailure", () => {
    it("equal sizes -> delivered (the bytes landed, only the ACK was lost)", () => {
        expect(reconcileChunkFailure(100, 100)).toBe("delivered");
        expect(reconcileChunkFailure(0, 0)).toBe("delivered");
    });

    it("remote size shorter than expected -> failed", () => {
        expect(reconcileChunkFailure(99, 100)).toBe("failed");
        expect(reconcileChunkFailure(0, 100)).toBe("failed");
    });

    it("remote size longer than expected -> failed (duplication/corruption)", () => {
        expect(reconcileChunkFailure(101, 100)).toBe("failed");
        expect(reconcileChunkFailure(200, 100)).toBe("failed");
    });

    it("null remote size (unstatable/missing file) -> failed", () => {
        expect(reconcileChunkFailure(null, 100)).toBe("failed");
        expect(reconcileChunkFailure(null, 0)).toBe("failed");
    });
});

describe("formatDownloadDoneText", () => {
    it("maps each terminal state to its banner text", () => {
        expect(formatDownloadDoneText("completed")).toBe("Download complete");
        expect(formatDownloadDoneText("cancelled")).toBe("Download cancelled");
        expect(formatDownloadDoneText("interrupted")).toBe("Download failed");
    });
});

describe("isDownloadFailure", () => {
    it("completed and cancelled are not failures", () => {
        expect(isDownloadFailure("completed")).toBe(false);
        expect(isDownloadFailure("cancelled")).toBe(false);
    });

    it("interrupted is a failure (persists until dismissed)", () => {
        expect(isDownloadFailure("interrupted")).toBe(true);
    });
});

describe("uploadPercent", () => {
    it("computes a clamped 0-100 percentage", () => {
        expect(uploadPercent(0, 100)).toBe(0);
        expect(uploadPercent(42, 100)).toBe(42);
        expect(uploadPercent(200, 100)).toBe(100);
    });

    it("renders 100 for an unknown/non-positive total (empty file completes instantly)", () => {
        expect(uploadPercent(0, 0)).toBe(100);
        expect(uploadPercent(10, -1)).toBe(100);
        expect(uploadPercent(10, NaN)).toBe(100);
    });

    it("renders 0 for non-finite or non-positive sent bytes", () => {
        expect(uploadPercent(-1, 100)).toBe(0);
        expect(uploadPercent(NaN, 100)).toBe(0);
        expect(uploadPercent(Infinity, 100)).toBe(0);
    });
});

describe("downloadPercent", () => {
    it("computes a clamped 0-100 percentage", () => {
        expect(downloadPercent(0, 100)).toBe(0);
        expect(downloadPercent(1, 100)).toBe(1);
        expect(downloadPercent(42, 100)).toBe(42);
        expect(downloadPercent(100, 100)).toBe(100);
        expect(downloadPercent(200, 100)).toBe(100); // clamped
    });

    it("rounds down to the nearest whole percent", () => {
        expect(downloadPercent(333, 1000)).toBe(33);
        expect(downloadPercent(999, 1000)).toBe(99);
    });

    it("returns 0 for an unknown (non-positive) total", () => {
        expect(downloadPercent(10, 0)).toBe(0);
        expect(downloadPercent(10, -1)).toBe(0);
    });

    it("returns 0 for non-finite or non-positive bytes", () => {
        expect(downloadPercent(0, 100)).toBe(0);
        expect(downloadPercent(-1, 100)).toBe(0);
        expect(downloadPercent(NaN, 100)).toBe(0);
        expect(downloadPercent(Infinity, 100)).toBe(0);
        expect(downloadPercent(50, NaN)).toBe(0);
    });
});

describe("createCancelToken", () => {
    it("starts uncancelled and flips exactly once on cancel()", () => {
        const token = createCancelToken();
        expect(token.isCancelled()).toBe(false);
        token.cancel();
        expect(token.isCancelled()).toBe(true);
        token.cancel(); // idempotent
        expect(token.isCancelled()).toBe(true);
    });

    it("whenCancelled resolves once cancelled (and never rejects)", async () => {
        const token = createCancelToken();
        let resolved = false;
        const waiting = token.whenCancelled().then(() => {
            resolved = true;
        });
        // Not resolved yet: nothing scheduled the deferred.
        await Promise.resolve();
        expect(resolved).toBe(false);
        token.cancel();
        await waiting;
        expect(resolved).toBe(true);
    });
});

describe("raceWithCancel", () => {
    it("throws CancelledError immediately when cancelled before start", async () => {
        const token = createCancelToken();
        token.cancel();
        await expect(raceWithCancel(Promise.resolve(42), token)).rejects.toBeInstanceOf(CancelledError);
    });

    it("rejects promptly when cancelled mid-flight, even though the work never settles", async () => {
        const token = createCancelToken();
        const work = new Promise<number>(() => {
            // never settles: simulates a stalled chunk RPC
        });
        const raced = raceWithCancel(work, token);
        token.cancel();
        await expect(raced).rejects.toBeInstanceOf(CancelledError);
    });

    it("resolves with the wrapped value when not cancelled", async () => {
        const token = createCancelToken();
        await expect(raceWithCancel(Promise.resolve(123), token)).resolves.toBe(123);
    });

    it("propagates the wrapped promise's rejection when not cancelled", async () => {
        const token = createCancelToken();
        await expect(raceWithCancel(Promise.reject(new Error("boom")), token)).rejects.toThrow("boom");
    });

    it("lets the wrapped promise win the race even if cancellation fires later", async () => {
        const token = createCancelToken();
        const result = await raceWithCancel(Promise.resolve("done"), token);
        expect(result).toBe("done");
        // Cancelling after completion must not affect an already-settled race.
        token.cancel();
        expect(token.isCancelled()).toBe(true);
    });

    it("throws on any subsequent race against an already-cancelled token", async () => {
        const token = createCancelToken();
        token.cancel();
        await expect(raceWithCancel(Promise.resolve(1), token)).rejects.toBeInstanceOf(CancelledError);
        await expect(raceWithCancel(Promise.resolve(2), token)).rejects.toBeInstanceOf(CancelledError);
    });
});
