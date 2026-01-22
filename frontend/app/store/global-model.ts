// Copyright 2025, Command Line Inc
// SPDX-License-Identifier: Apache-2.0

import * as WOS from "@/app/store/wos";
import { ClientModel } from "@/app/store/client-model";
import { atom, Atom } from "jotai";

class GlobalModel {
    private static instance: GlobalModel;

    windowId: string;
    builderId: string;
    platform: NodeJS.Platform;

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
        ClientModel.getInstance().initialize(initOpts.clientId);
        this.windowId = initOpts.windowId;
        this.builderId = initOpts.builderId;
        this.platform = initOpts.platform;

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