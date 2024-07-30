// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TosModal } from "./tos";
import { UserInputModal } from "./userinputmodal";

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [TosModal.displayName || "TosModal"]: TosModal,
    [UserInputModal.displayName || "UserInputModal"]: UserInputModal,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
