// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as jotai from "jotai";
import { getModalComponent } from "./modalregistry";
import { TosModal } from "./tos";

const ModalsRenderer = () => {
    const clientData = jotai.useAtomValue(atoms.client);
    const [modals] = jotai.useAtom(modalsModel.modalsAtom);
    const rtn: JSX.Element[] = [];
    for (const modal of modals) {
        const ModalComponent = getModalComponent(modal.displayName);
        if (ModalComponent) {
            rtn.push(<ModalComponent key={modal.displayName} {...modal.props} />);
        }
    }
    if (!clientData.tosagreed) {
        rtn.push(<TosModal key={TosModal.displayName} />);
    }
    return <>{rtn}</>;
};

export { ModalsRenderer };
