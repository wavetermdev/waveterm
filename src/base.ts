import * as path from "path";
import * as fs from "fs";
import {flockSync} from "fs-ext";

const HomeVarName = "HOME";
const PromptHomeVarName = "PROMPT_HOME";
const PromptLockFile = "prompt-electron.lock";
const DBFileName = "prompt.db";
const SessionsDirBaseName = "sessions";
const RemotesDirBaseName = "remotes";
const PromptDirName = "prompt";

function getPromptHomeDir() : string {
    if (process.env[PromptHomeVarName]) {
        return process.env[PromptHomeVarName];
    }
    let homeDir = process.env[HomeVarName];
    if (!homeDir) {
        homeDir = "/";
    }
    return path.join(homeDir, PromptDirName);
}

function getDBName() : string {
    let promptHome = getPromptHomeDir();
    return path.join(promptHome, DBFileName);
}

function acquirePromptElectronLock() : File {
    let promptHome = getPromptHomeDir();
    let lockFileName = path.join(promptHome, PromptLockFile);
    let fd = fs.openSync(lockFileName, "w", 0o600);
    flockSync(fd, "exnb");
    return fd;
}

export {getPromptHomeDir, getDBName, acquirePromptElectronLock};
