// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AboutModal } from "./about";
import { TosModal } from "./tos";
import { UserInputModal } from "./userinputmodal";

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [TosModal.displayName || "TosModal"]: TosModal,
    [UserInputModal.displayName || "UserInputModal"]: UserInputModal,
    [AboutModal.displayName || "AboutModal"]: AboutModal,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
