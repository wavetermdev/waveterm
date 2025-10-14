// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { globalStore } from "./global";

class ModalsModel {
    modalsAtom: jotai.PrimitiveAtom<Array<{ displayName: string; props?: any }>>;
    newInstallOnboardingOpen: jotai.PrimitiveAtom<boolean>;
    upgradeOnboardingOpen: jotai.PrimitiveAtom<boolean>;

    constructor() {
        this.newInstallOnboardingOpen = jotai.atom(false);
        this.upgradeOnboardingOpen = jotai.atom(false);
        this.modalsAtom = jotai.atom([]);
    }

    pushModal = (displayName: string, props?: any) => {
        const modals = globalStore.get(this.modalsAtom);
        globalStore.set(this.modalsAtom, [...modals, { displayName, props }]);
    };

    popModal = (callback?: () => void) => {
        const modals = globalStore.get(this.modalsAtom);
        if (modals.length > 0) {
            const updatedModals = modals.slice(0, -1);
            globalStore.set(this.modalsAtom, updatedModals);
            if (callback) callback();
        }
    };

    hasOpenModals(): boolean {
        const modals = globalStore.get(this.modalsAtom);
        return modals.length > 0;
    }

    isModalOpen(displayName: string): boolean {
        const modals = globalStore.get(this.modalsAtom);
        return modals.some((modal) => modal.displayName === displayName);
    }
}

const modalsModel = new ModalsModel();

export { modalsModel };
