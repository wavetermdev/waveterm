// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { Atom, atom, PrimitiveAtom, useAtomValue } from "jotai";
import "./settingsview.scss";

class SettingsViewModel implements ViewModel {
    viewType: string;
    showTocAtom: PrimitiveAtom<boolean>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor() {
        this.viewType = "settings";
        this.showTocAtom = atom(false);
    }
}

function makeSettingsViewModel() {
    return new SettingsViewModel();
}

function SettingsRow(settingKey: string, settingValue: unknown) {
    return <div></div>;
}

function SettingsRowString(settingKey: string, settingValue: unknown) {
    return (
        <div>
            <h3>{settingKey}</h3>
            <input></input>
        </div>
    );
}

function SettingsRowNum(settingKey: string, settingValue: unknown) {
    return (
        <div>
            <h3>{settingKey}</h3>
        </div>
    );
}

function SettingsRowBool(settingKey: string, settingValue: unknown) {
    return (
        <div>
            <h3>{settingKey}</h3>
        </div>
    );
}

function SettingsView({ model }: { model: SettingsViewModel }) {
    const baseSettings = useAtomValue(atoms.settingsAtom);

    return <div>{Object.entries(baseSettings).map(([key, value]) => SettingsRow(key, value))}</div>;
}

export { makeSettingsViewModel, SettingsView, SettingsViewModel };
