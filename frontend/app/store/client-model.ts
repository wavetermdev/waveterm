// Copyright 2025, Command Line Inc
// SPDX-License-Identifier: Apache-2.0

import * as WOS from "@/app/store/wos";
import { atom, Atom } from "jotai";

class ClientModel {
    private static instance: ClientModel;

    clientId: string;
    clientAtom!: Atom<Client>;

    private constructor() {
        // private constructor for singleton pattern
    }

    static getInstance(): ClientModel {
        if (!ClientModel.instance) {
            ClientModel.instance = new ClientModel();
        }
        return ClientModel.instance;
    }

    initialize(clientId: string): void {
        this.clientId = clientId;

        this.clientAtom = atom((get) => {
            if (this.clientId == null) {
                return null;
            }
            return WOS.getObjectValue(WOS.makeORef("client", this.clientId), get);
        });
    }
}

export { ClientModel };