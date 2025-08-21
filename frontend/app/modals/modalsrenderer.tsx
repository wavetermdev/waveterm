// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as jotai from "jotai";
import { useEffect } from "react";
import { getModalComponent } from "./modalregistry";
import { TosModal } from "./tos";

const ModalsRenderer = () => {
    const clientData = jotai.useAtomValue(atoms.client);
    const [tosOpen, setTosOpen] = jotai.useAtom(modalsModel.tosOpen);
    const [modals] = jotai.useAtom(modalsModel.modalsAtom);
    const rtn: React.ReactElement[] = [];
    for (const modal of modals) {
        const ModalComponent = getModalComponent(modal.displayName);
        if (ModalComponent) {
            rtn.push(<ModalComponent key={modal.displayName} {...modal.props} />);
        }
    }
    if (tosOpen) {
        rtn.push(<TosModal key={TosModal.displayName} />);
    }
    useEffect(() => {
        if (!clientData.tosagreed) {
            setTosOpen(true);
        }
    }, [clientData]);
    useEffect(() => {
        globalStore.set(atoms.modalOpen, rtn.length > 0);
    }, [rtn]);

    return <>{rtn}</>;
};

export { ModalsRenderer };
