// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { v4 as uuidv4 } from "uuid";
import { ModalStoreEntry } from "../types/types";
import { modalsRegistry } from "../app/common/modals/registry";
import { OArr } from "../types/types";

class ModalsModel {
    store: OArr<ModalStoreEntry> = mobx.observable.array([], { name: "ModalsModel-store", deep: false });

    pushModal(modalId: string, props?: any) {
        const modalFactory = modalsRegistry[modalId];

        if (modalFactory && !this.store.some((modal) => modal.id === modalId)) {
            mobx.action(() => {
                this.store.push({ id: modalId, component: modalFactory, uniqueKey: uuidv4(), props });
            })();
        }
    }

    popModal() {
        mobx.action(() => {
            this.store.pop();
        })();
    }
}

export { ModalsModel };
