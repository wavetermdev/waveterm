// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleOsc16162Command } from "./osc-handlers";

const { setRTInfoCommandMock } = vi.hoisted(() => ({
    setRTInfoCommandMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        SetRTInfoCommand: setRTInfoCommandMock,
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

function makeTermWrap() {
    return {
        terminal: {},
        shellIntegrationStatusAtom: jotai.atom(null) as jotai.PrimitiveAtom<"ready" | "running-command" | null>,
        lastCommandAtom: jotai.atom(null) as jotai.PrimitiveAtom<string | null>,
        shellInputBufferAtom: jotai.atom(null) as jotai.PrimitiveAtom<string | null>,
        shellInputCursorAtom: jotai.atom(null) as jotai.PrimitiveAtom<number | null>,
    } as any;
}

describe("handleOsc16162Command input readback", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setRTInfoCommandMock.mockClear();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it("updates shell input buffer and cursor from buffer64 payload", async () => {
        const termWrap = makeTermWrap();
        const buffer = "echo hello λ";
        const buffer64 = stringToBase64(buffer);

        expect(handleOsc16162Command(`I;{"buffer64":"${buffer64}","cursor":4}`, "block-1", true, termWrap)).toBe(true);

        expect(globalStore.get(termWrap.shellInputBufferAtom)).toBe(buffer);
        expect(globalStore.get(termWrap.shellInputCursorAtom)).toBe(4);

        await vi.runAllTimersAsync();

        expect(setRTInfoCommandMock).toHaveBeenCalledWith(
            {},
            {
                oref: "block:block-1",
                data: {
                    "shell:inputbuffer64": buffer64,
                    "shell:inputcursor": 4,
                },
            }
        );
    });

    it("preserves empty buffer and cursor zero in runtime info", async () => {
        const termWrap = makeTermWrap();

        expect(handleOsc16162Command('I;{"buffer64":"","cursor":0}', "block-2", true, termWrap)).toBe(true);

        expect(globalStore.get(termWrap.shellInputBufferAtom)).toBe("");
        expect(globalStore.get(termWrap.shellInputCursorAtom)).toBe(0);

        await vi.runAllTimersAsync();

        expect(setRTInfoCommandMock).toHaveBeenCalledWith(
            {},
            {
                oref: "block:block-2",
                data: {
                    "shell:inputbuffer64": "",
                    "shell:inputcursor": 0,
                },
            }
        );
    });

    it("ignores legacy inputempty payloads", async () => {
        const termWrap = makeTermWrap();

        expect(handleOsc16162Command('I;{"inputempty":false}', "block-3", true, termWrap)).toBe(true);

        expect(globalStore.get(termWrap.shellInputBufferAtom)).toBeNull();
        expect(globalStore.get(termWrap.shellInputCursorAtom)).toBeNull();

        await vi.runAllTimersAsync();

        expect(setRTInfoCommandMock).not.toHaveBeenCalled();
    });
});
