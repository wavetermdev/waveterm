// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { atoms, globalStore } from "@/app/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { Atom, atom, useAtomValue } from "jotai";

import "./background.scss";

type BackgroundType = {
    label: string;
    color: string;
    click: () => void;
};

class BackgroundModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.viewText = atom((get) => {
            return [];
        });
        this.viewType = "background";
        this.viewIcon = atom("fill-drip");
        this.viewName = atom("Background");
    }
}

function makeBackgroundModel(blockId: string, nodeModel: BlockNodeModel) {
    return new BackgroundModel(blockId, nodeModel);
}

function Background({ model }: { model: BackgroundModel }) {
    const tabId = useAtomValue(atoms.staticTabId);
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
                color: preset["bg"] ?? "var(--main-bg-color)",
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
                            <div className="bg-preview" style={{ background: bg.color }}></div>
                            <div className="bg-label">{bg.label}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export { Background, BackgroundModel, makeBackgroundModel };
