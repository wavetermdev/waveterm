// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import os from "node:os";
// import path from "node:path";
// import fs from "node:fs";
// import fsAsync from "node:fs/promises";

// const logFolder = path.join(os.homedir(), ".inshellisense");
// const logTarget = path.join(logFolder, "inshellisense.log");
let logEnabled = false;

const reset = async () => {
    // if (!fs.existsSync(logTarget)) {
    //   await fsAsync.mkdir(logFolder, { recursive: true });
    // }
    // await fsAsync.writeFile(logTarget, "");
    // noop
};

const debug = (content: object) => {
    if (!logEnabled) {
        return;
    }
    // fs.appendFile(logTarget, JSON.stringify(content) + "\n", (err) => {
    //     if (err != null) {
    //         throw err;
    //     }
    // });
    console.log("[autocomplete]", content);
};

export const enable = async () => {
    await reset();
    logEnabled = true;
};

export default { reset, debug, enable };
