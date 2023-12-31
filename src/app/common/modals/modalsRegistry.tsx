// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import {
    AboutModal,
    CreateRemoteConnModal,
    ViewRemoteConnDetailModal,
    EditRemoteConnModal,
    AlertModal,
    TabSwitcherModal,
} from "./modals";
import { ScreenSettingsModal, SessionSettingsModal, LineSettingsModal, ClientSettingsModal } from "./settings";
import * as constants from "../../appconst";

const modalsRegistry: { [key: string]: () => React.ReactElement } = {
    [constants.ABOUT]: () => <AboutModal />,
    [constants.CREATE_REMOTE]: () => <CreateRemoteConnModal />,
    [constants.VIEW_REMOTE]: () => <ViewRemoteConnDetailModal />,
    [constants.EDIT_REMOTE]: () => <EditRemoteConnModal />,
    [constants.ALERT]: () => <AlertModal />,
    [constants.SCREEN_SETTINGS]: () => <ScreenSettingsModal />,
    [constants.SESSION_SETTINGS]: () => <SessionSettingsModal />,
    [constants.LINE_SETTINGS]: () => <LineSettingsModal />,
    [constants.CLIENT_SETTINGS]: () => <ClientSettingsModal />,
    [constants.TAB_SWITCHER]: () => <TabSwitcherModal />,
};

export { modalsRegistry };
