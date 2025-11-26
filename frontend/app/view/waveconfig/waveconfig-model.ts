// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, Atom } from "jotai";
import { WaveConfigView } from "./waveconfig";

class WaveConfigViewModel implements ViewModel {
    viewType: string;
    viewIcon: Atom<string>;
    viewName: Atom<string>;

    constructor() {
        this.viewType = "waveconfig";
        this.viewIcon = atom("gear");
        this.viewName = atom("Wave Config");
    }

    get viewComponent(): ViewComponent {
        return WaveConfigView;
    }
}

export { WaveConfigViewModel };