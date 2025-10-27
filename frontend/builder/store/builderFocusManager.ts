// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

export type BuilderFocusType = "waveai" | "app";

export class BuilderFocusManager {
    private static instance: BuilderFocusManager | null = null;

    focusType: PrimitiveAtom<BuilderFocusType> = atom("app");

    private constructor() {}

    static getInstance(): BuilderFocusManager {
        if (!BuilderFocusManager.instance) {
            BuilderFocusManager.instance = new BuilderFocusManager();
        }
        (window as any).builderFocusManager = BuilderFocusManager.instance;
        return BuilderFocusManager.instance;
    }

    setWaveAIFocused() {
        globalStore.set(this.focusType, "waveai");
    }

    setAppFocused() {
        globalStore.set(this.focusType, "app");
    }

    getFocusType(): BuilderFocusType {
        return globalStore.get(this.focusType);
    }
}
