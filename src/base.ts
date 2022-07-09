import * as path from "path";
import * as fs from "fs";
import {flockSync} from "fs-ext";

const HomeVarName = "HOME";
const ScHomeVarName = "SCRIPTHAUS_HOME";
const SCLockFile = "sh2-electron.lock";
const DBFileName = "sh2.db";
const SessionsDirBaseName = "sessions";
const RemotesDirBaseName = "remotes";
const ScDirName = "scripthaus";

function getScHomeDir() : string {
    if (process.env[ScHomeVarName]) {
        return process.env[ScHomeVarName];
    }
    let homeDir = process.env[HomeVarName];
    if (!homeDir) {
        homeDir = "/";
    }
    return path.join(homeDir, ScDirName);
}

function getDBName() : string {
    let scHome = getScHomeDir();
    return path.join(scHome, DBFileName);
}

function acquireSCElectronLock() : File {
    let scHome = getScHomeDir();
    let lockFileName = path.join(scHome, SCLockFile);
    let fd = fs.openSync(lockFileName, "w", 0o600);
    flockSync(fd, "exnb");
    return fd;
}

export {getScHomeDir, getDBName, acquireSCElectronLock};
