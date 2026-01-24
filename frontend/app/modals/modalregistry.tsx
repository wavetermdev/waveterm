// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MessageModal } from "@/app/modals/messagemodal";
import { NewInstallOnboardingModal } from "@/app/onboarding/onboarding";
import { UpgradeOnboardingModal } from "@/app/onboarding/onboarding-upgrade";
import { AboutModal } from "./about";
import { UserInputModal } from "./userinputmodal";

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [NewInstallOnboardingModal.displayName || "NewInstallOnboardingModal"]: NewInstallOnboardingModal,
    [UpgradeOnboardingModal.displayName || "UpgradeOnboardingModal"]: UpgradeOnboardingModal,
    [UserInputModal.displayName || "UserInputModal"]: UserInputModal,
    [AboutModal.displayName || "AboutModal"]: AboutModal,
    [MessageModal.displayName || "MessageModal"]: MessageModal,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
