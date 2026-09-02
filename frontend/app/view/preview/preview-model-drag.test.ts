// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { atom } from "jotai";
import { describe, expect, it } from "vitest";
import { PreviewModel } from "./preview-model";

function makePreviewModel(blockId: string): PreviewModel {
    const env = makeMockWaveEnv({
        mockWaveObjs: {
            [`block:${blockId}`]: {
                otype: "block",
                oid: blockId,
                version: 1,
                meta: {
                    file: "/home/a.txt",
                },
            } as Block,
        },
    });
    return new PreviewModel({
        blockId,
        nodeModel: {
            isFocused: atom(true),
            focusNode: () => {},
        } as any,
        tabModel: {} as any,
        waveEnv: env,
    });
}

describe("preview model drag source", () => {
    it("starts with no drag source", () => {
        const model = makePreviewModel("preview-drag-block");

        expect(globalStore.get(model.dragSource)).toBe(null);
    });

    it("records a drag source in the drag source atom", () => {
        const model = makePreviewModel("preview-drag-block-set");

        const value: DragSourceState = {
            move: false,
            files: [
                {
                    uri: "wsh://conn/home/a.txt",
                    absParent: "/home",
                    relName: "a.txt",
                    isDir: false,
                },
            ],
        };
        globalStore.set(model.dragSource, value);

        expect(globalStore.get(model.dragSource)).toEqual(value);
    });

    it("clears the drag source atom", () => {
        const model = makePreviewModel("preview-drag-block-clear");

        globalStore.set(model.dragSource, {
            move: false,
            files: [
                {
                    uri: "wsh://conn/home/a.txt",
                    absParent: "/home",
                    relName: "a.txt",
                    isDir: false,
                },
            ],
        });
        globalStore.set(model.dragSource, null);

        expect(globalStore.get(model.dragSource)).toBe(null);
    });
});
