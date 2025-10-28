// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, WOS } from "@/store/global";
import { atom, type PrimitiveAtom } from "jotai";

export class BuilderBuildPanelModel {
    private static instance: BuilderBuildPanelModel | null = null;

    outputLines: PrimitiveAtom<string[]> = atom<string[]>([]);
    outputUnsubFn: (() => void) | null = null;
    initialized = false;

    private constructor() {}

    static getInstance(): BuilderBuildPanelModel {
        if (!BuilderBuildPanelModel.instance) {
            BuilderBuildPanelModel.instance = new BuilderBuildPanelModel();
        }
        return BuilderBuildPanelModel.instance;
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        const builderId = globalStore.get(atoms.builderId);
        if (!builderId) return;

        if (this.outputUnsubFn) {
            this.outputUnsubFn();
        }

        this.outputUnsubFn = waveEventSubscribe({
            eventType: "builderoutput",
            scope: WOS.makeORef("builder", builderId),
            handler: (event) => {
                const data = event.data as { lines?: string[]; reset?: boolean };
                if (!data) return;

                if (data.reset) {
                    globalStore.set(this.outputLines, data.lines || []);
                } else if (data.lines && data.lines.length > 0) {
                    globalStore.set(this.outputLines, (prev) => [...prev, ...data.lines]);
                }
            },
        });

        try {
            const output = await RpcApi.GetBuilderOutputCommand(TabRpcClient, builderId);
            globalStore.set(this.outputLines, output || []);
        } catch (err) {
            console.error("Failed to load builder output:", err);
        }
    }

    clearOutput() {
        globalStore.set(this.outputLines, []);
    }

    dispose() {
        if (this.outputUnsubFn) {
            this.outputUnsubFn();
            this.outputUnsubFn = null;
        }
        this.initialized = false;
    }
}