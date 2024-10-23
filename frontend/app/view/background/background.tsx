// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/app/store/global";
import { WebViewModel } from "@/app/view/webview/webview";
import { NodeModel } from "@/layout/index";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { atom, useAtomValue } from "jotai";

import "./background.less";

type BackgroundType = {
    label: string;
    click: () => void;
};

class BackgroundModel extends WebViewModel {
    constructor(blockId: string, nodeModel: NodeModel) {
        super(blockId, nodeModel);

        this.viewText = atom((get) => {
            return [];
        });
        this.viewType = "background";
        this.viewIcon = atom("fill-drip");
        this.viewName = atom("Background");
    }
}

function makeBackgroundModel(blockId: string, nodeModel: NodeModel) {
    return new BackgroundModel(blockId, nodeModel);
}

function Background({ model }: { model: BackgroundModel }) {
    const tabId = useAtomValue(atoms.activeTabId);
    const backgrounds: BackgroundType[] = [];
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const bgPresets: string[] = [];
    for (const key in fullConfig?.presets ?? {}) {
        if (key.startsWith("bg@")) {
            bgPresets.push(key);
        }
    }
    bgPresets.sort((a, b) => {
        const aOrder = fullConfig.presets[a]["display:order"] ?? 0;
        const bOrder = fullConfig.presets[b]["display:order"] ?? 0;
        return aOrder - bOrder;
    });
    if (bgPresets.length > 0) {
        const oref = WOS.makeORef("tab", tabId);
        for (const presetName of bgPresets) {
            const preset = fullConfig.presets[presetName];
            if (preset == null) {
                continue;
            }
            backgrounds.push({
                label: preset["display:name"] ?? presetName,
                click: () => {
                    services.ObjectService.UpdateObjectMeta(oref, preset);
                },
            });
        }
    }

    return (
        <div className="background">
            <div className="background-inner">
                {backgrounds.map((bg, index) => {
                    return (
                        <div key={`${bg.label}-${index}`} className="bg-item" onClick={() => bg.click()}>
                            <div className="bg-preview" style={{ backgroundColor: bg.label }}></div>
                            <div className="bg-label">{bg.label}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export { Background, BackgroundModel, makeBackgroundModel };
