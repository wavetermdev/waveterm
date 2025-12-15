// Copyright 2025, Command Line Inc
// SPDX-License-Identifier: Apache-2.0

import * as WOS from "@/app/store/wos";
import { atom, Atom } from "jotai";

class GlobalModel {
    private static instance: GlobalModel;

    clientId: string;
    windowId: string;
    builderId: string;
    platform: NodeJS.Platform;

    clientAtom!: Atom<Client>;
    windowDataAtom!: Atom<WaveWindow>;
    workspaceAtom!: Atom<Workspace>;

    private constructor() {
        // private constructor for singleton pattern
    }

    static getInstance(): GlobalModel {
        if (!GlobalModel.instance) {
            GlobalModel.instance = new GlobalModel();
        }
        return GlobalModel.instance;
    }

    async initialize(initOpts: GlobalInitOptions): Promise<void> {
        this.clientId = initOpts.clientId;
        this.windowId = initOpts.windowId;
        this.builderId = initOpts.builderId;
        this.platform = initOpts.platform;

        this.clientAtom = atom((get) => {
            if (this.clientId == null) {
                return null;
            }
            return WOS.getObjectValue(WOS.makeORef("client", this.clientId), get);
        });

        this.windowDataAtom = atom((get) => {
            if (this.windowId == null) {
                return null;
            }
            return WOS.getObjectValue<WaveWindow>(WOS.makeORef("window", this.windowId), get);
        });

        this.workspaceAtom = atom((get) => {
            const windowData = get(this.windowDataAtom);
            if (windowData == null) {
                return null;
            }
            return WOS.getObjectValue(WOS.makeORef("workspace", windowData.workspaceid), get);
        });
    }
}

export { GlobalModel };