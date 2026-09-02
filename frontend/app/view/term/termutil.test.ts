import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for heavy dependencies
// ---------------------------------------------------------------------------

vi.mock("@xterm/xterm", () => ({ Terminal: class {} }));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        WriteTempFileCommand: vi.fn(),
        RemoteWriteTempFileCommand: vi.fn(),
        FileAppendCommand: vi.fn(),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

import { RpcApi } from "@/app/store/wshclientapi";
import {
    CancelledError,
    createCancelToken,
    UploadChunkSize,
    UploadChunkTimeoutMs,
} from "@/app/view/preview/preview-model-upload";
import { createRemoteTempFileFromBlob } from "./termutil";

const mockRemoteWrite = RpcApi.RemoteWriteTempFileCommand as unknown as ReturnType<typeof vi.fn>;
const mockFileAppend = RpcApi.FileAppendCommand as unknown as ReturnType<typeof vi.fn>;

// Builds a blob that is UploadChunkSize + tail.length bytes long: the first
// 3MB are zeros and the final bytes carry a recognizable tail pattern so the
// second (append) chunk can be verified byte-for-byte.
function makeMultiChunkBlob(tail: Uint8Array): Blob {
    const bytes = new Uint8Array(UploadChunkSize + tail.length);
    bytes.set(tail, UploadChunkSize);
    return new Blob([bytes], { type: "application/octet-stream" });
}

describe("createRemoteTempFileFromBlob", () => {
    beforeEach(() => {
        mockRemoteWrite.mockReset();
        mockFileAppend.mockReset();
        mockRemoteWrite.mockResolvedValue("/tmp/waveterm-abc123/file");
        mockFileAppend.mockResolvedValue(undefined);
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it("passes the provided filename through to the first-chunk RPC unchanged", async () => {
        const blob = new Blob(["hello"], { type: "application/pdf" });
        const path = await createRemoteTempFileFromBlob(blob, "report.pdf", "ssh:myhost");

        expect(mockRemoteWrite).toHaveBeenCalledTimes(1);
        expect(mockFileAppend).not.toHaveBeenCalled();
        const [client, data, opts] = mockRemoteWrite.mock.calls[0];
        expect(data.filename).toBe("report.pdf");
        expect(data.data64).toBeTruthy();
        expect(opts).toEqual({ route: "conn:ssh:myhost", timeout: UploadChunkTimeoutMs });
        expect(path).toBe("/tmp/waveterm-abc123/file");
    });

    it("generates a waveterm_paste name when no filename is given (clipboard)", async () => {
        const blob = new Blob(["img"], { type: "image/png" });
        await createRemoteTempFileFromBlob(blob, undefined, "ssh:myhost");

        const data = mockRemoteWrite.mock.calls[0][1];
        expect(data.filename).toMatch(/^waveterm_paste_\d+_[a-z0-9]{6}\.png$/);
    });

    it("falls back to a generated name for an empty filename", async () => {
        const blob = new Blob(["img"], { type: "image/png" });
        await createRemoteTempFileFromBlob(blob, "", "ssh:myhost");

        const data = mockRemoteWrite.mock.calls[0][1];
        expect(data.filename).toMatch(/^waveterm_paste_\d+_[a-z0-9]{6}\.png$/);
    });

    it("preserves filenames with spaces, quotes, and unicode", async () => {
        const blob = new Blob(["data"], { type: "text/plain" });
        const tricky = "my file's (final) 副本.txt";
        await createRemoteTempFileFromBlob(blob, tricky, "ssh:myhost");

        const data = mockRemoteWrite.mock.calls[0][1];
        expect(data.filename).toBe(tricky);
    });

    it("uses the .bin extension for unknown mime types when generating a name", async () => {
        const blob = new Blob(["data"], { type: "application/octet-stream" });
        await createRemoteTempFileFromBlob(blob, undefined, "ssh:myhost");

        const data = mockRemoteWrite.mock.calls[0][1];
        expect(data.filename).toMatch(/\.bin$/);
    });

    it("omits the route (but keeps the timeout) when no connName is given", async () => {
        const blob = new Blob(["img"], { type: "image/png" });
        await createRemoteTempFileFromBlob(blob, "x.png");

        const [, , opts] = mockRemoteWrite.mock.calls[0];
        expect(opts.route).toBeUndefined();
        expect(opts.timeout).toBe(UploadChunkTimeoutMs);
        expect(mockFileAppend).not.toHaveBeenCalled();
    });

    it("encodes a single-chunk blob as base64 in data64 without appending", async () => {
        const blob = new Blob(["hello"], { type: "text/plain" });
        await createRemoteTempFileFromBlob(blob, "hello.txt", "ssh:myhost");

        const data = mockRemoteWrite.mock.calls[0][1];
        expect(Buffer.from(data.data64, "base64").toString("utf8")).toBe("hello");
        expect(mockFileAppend).not.toHaveBeenCalled();
    });

    it("splits a multi-chunk blob: first chunk writes the temp file, the rest append to its remote URI", async () => {
        const tail = new Uint8Array([1, 2, 3, 4]);
        const blob = makeMultiChunkBlob(tail);
        const path = await createRemoteTempFileFromBlob(blob, "big.bin", "ssh:myhost");

        expect(mockRemoteWrite).toHaveBeenCalledTimes(1);
        expect(mockFileAppend).toHaveBeenCalledTimes(1);
        const [client, data, opts] = mockFileAppend.mock.calls[0];
        expect(data.info.path).toBe("wsh://ssh:myhost//tmp/waveterm-abc123/file");
        expect(Buffer.from(data.data64, "base64").equals(Buffer.from(tail))).toBe(true);
        expect(opts).toEqual({ timeout: UploadChunkTimeoutMs });
        expect(path).toBe("/tmp/waveterm-abc123/file");
    });

    it("reports cumulative progress after each chunk", async () => {
        const tail = new Uint8Array([1, 2, 3, 4]);
        const blob = makeMultiChunkBlob(tail);
        const progress: Array<[number, number]> = [];
        await createRemoteTempFileFromBlob(blob, "big.bin", "ssh:myhost", {
            onProgress: (sent, total) => progress.push([sent, total]),
        });

        expect(progress).toEqual([
            [UploadChunkSize, UploadChunkSize + tail.length],
            [UploadChunkSize + tail.length, UploadChunkSize + tail.length],
        ]);
    });

    it("rejects a blob over the resolved cap without calling any RPC", async () => {
        const tail = new Uint8Array([1, 2, 3, 4]);
        const blob = makeMultiChunkBlob(tail); // UploadChunkSize + 4 bytes

        await expect(
            createRemoteTempFileFromBlob(blob, "big.bin", "ssh:myhost", { maxUploadSize: UploadChunkSize })
        ).rejects.toThrow('File "big.bin" exceeds 3MB size limit');
        expect(mockRemoteWrite).not.toHaveBeenCalled();
        expect(mockFileAppend).not.toHaveBeenCalled();
    });

    it("rejects with CancelledError when the token is already cancelled, without calling any RPC", async () => {
        const blob = new Blob(["hello"], { type: "text/plain" });
        const token = createCancelToken();
        token.cancel();

        await expect(createRemoteTempFileFromBlob(blob, "hello.txt", "ssh:myhost", { cancelToken: token })).rejects.toBeInstanceOf(
            CancelledError
        );
        expect(mockRemoteWrite).not.toHaveBeenCalled();
        expect(mockFileAppend).not.toHaveBeenCalled();
    });
});
