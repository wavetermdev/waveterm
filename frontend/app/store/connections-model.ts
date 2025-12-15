// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isWindows } from "@/util/platformutil";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";

class ConnectionsModel {
    private static instance: ConnectionsModel;
    gitBashPathAtom: PrimitiveAtom<string> = atom("") as PrimitiveAtom<string>;
    hasGitBashAtom: Atom<boolean>;

    private constructor() {
        this.hasGitBashAtom = atom((get) => {
            if (!isWindows()) {
                return false;
            }
            const path = get(this.gitBashPathAtom);
            return path !== "";
        });
        this.loadGitBashPath();
    }

    static getInstance(): ConnectionsModel {
        if (!ConnectionsModel.instance) {
            ConnectionsModel.instance = new ConnectionsModel();
        }
        return ConnectionsModel.instance;
    }

    async loadGitBashPath(rescan: boolean = false): Promise<void> {
        if (!isWindows()) {
            return;
        }
        try {
            const path = await RpcApi.FindGitBashCommand(TabRpcClient, rescan, { timeout: 2000 });
            globalStore.set(this.gitBashPathAtom, path);
        } catch (error) {
            console.error("Failed to find git bash path:", error);
            globalStore.set(this.gitBashPathAtom, "");
        }
    }

    getGitBashPath(): string {
        return globalStore.get(this.gitBashPathAtom);
    }
}

export { ConnectionsModel };
