// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { NewInstallOnboardingModal } from "@/app/onboarding/onboarding";
import { ClientModel } from "@/app/store/client-model";
import { globalStore } from "@/app/store/jotaiStore";
import { atoms } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as jotai from "jotai";
import { useEffect } from "react";
import { getModalComponent } from "./modalregistry";

const ModalsRenderer = () => {
    const clientData = jotai.useAtomValue(ClientModel.getInstance().clientAtom);
    const [newInstallOnboardingOpen, setNewInstallOnboardingOpen] = jotai.useAtom(modalsModel.newInstallOnboardingOpen);
    const [modals] = jotai.useAtom(modalsModel.modalsAtom);

    const rtn: React.ReactElement[] = [];
    for (const modal of modals) {
        const ModalComponent = getModalComponent(modal.displayName);
        if (ModalComponent) {
            rtn.push(<ModalComponent key={modal.displayName} {...modal.props} />);
        }
    }
    // User input prompts are now rendered per-block in UserInputPromptOverlay
    if (newInstallOnboardingOpen) {
        rtn.push(<NewInstallOnboardingModal key={NewInstallOnboardingModal.displayName} />);
    }
    useEffect(() => {
        if (!clientData.tosagreed) {
            setNewInstallOnboardingOpen(true);
        }
    }, [clientData]);

    // RemoteTerm: upstream "what's new" upgrade modals (onboarding-upgrade-*) are
    // intentionally suppressed — they describe Wave's feature history, not the fork's.
    useEffect(() => {
        const hasBlockingModals = rtn.length > 0;
        globalStore.set(atoms.modalOpen, hasBlockingModals);
    }, [rtn]);

    return <>{rtn}</>;
};

export { ModalsRenderer };
