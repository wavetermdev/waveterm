// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { GlobalModel } from "../../../model";
import * as appconst from "../../appconst";

function ShowWaveShellInstallPrompt(callbackFn: () => void) {
    let message: string = `
In order to use Wave's advanced features like unified history and persistent sessions, Wave installs a small, open-source helper program called WaveShell on your remote machine.  WaveShell does not open any external ports and only communicates with your *local* Wave terminal instance over ssh.  For more information please see [the docs](https://docs.waveterm.dev/reference/waveshell).        
        `;
    message = message.trim();
    let prtn = GlobalModel.showAlert({
        message: message,
        confirm: true,
        markdown: true,
        confirmflag: appconst.ConfirmKey_HideShellPrompt,
    });
    prtn.then((confirm) => {
        if (!confirm) {
            return;
        }
        if (callbackFn) {
            callbackFn();
        }
    });
}

export { ShowWaveShellInstallPrompt };
