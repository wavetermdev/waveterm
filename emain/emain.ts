// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import * as electron from "electron";
import { globalEvents } from "emain/emain-events";
import { sprintf } from "sprintf-js";
import * as services from "../frontend/app/store/services";
import { initElectronWshrpc, shutdownWshrpc } from "../frontend/app/store/wshrpcutil-base";
import { fireAndForget, sleep } from "../frontend/util/util";
import { AuthKey, configureAuthKeyRequestInjection } from "./authkey";
import {
    getActivityState,
    getAndClearTermCommandsRun,
    getForceQuit,
    getGlobalIsRelaunching,
    setForceQuit,
    setGlobalIsQuitting,
    setGlobalIsStarting,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { initIpcHandlers } from "./emain-ipc";
import { log } from "./emain-log";
import { initMenuEventSubscriptions, makeAndSetAppMenu, makeDockTaskbar } from "./emain-menu";
import {
    checkIfRunningUnderARM64Translation,
    getElectronAppBasePath,
    getElectronAppUnpackedBasePath,
    getWaveConfigDir,
    getWaveDataDir,
    isDev,
    unameArch,
    unamePlatform,
} from "./emain-platform";
import { ensureHotSpareTab, setMaxTabCacheSize } from "./emain-tabview";
import { getIsWaveSrvDead, getWaveSrvProc, getWaveSrvReady, runWaveSrv } from "./emain-wavesrv";
import {
    createBrowserWindow,
    createNewWaveWindow,
    focusedWaveWindow,
    getAllWaveWindows,
    getWaveWindowById,
    getWaveWindowByWorkspaceId,
    registerGlobalHotkey,
    relaunchBrowserWindows,
    WaveBrowserWindow,
} from "./emain-window";
import { ElectronWshClient, initElectronWshClient } from "./emain-wsh";
import { getLaunchSettings } from "./launchsettings";
import { configureAutoUpdater, updater } from "./updater";

const electronApp = electron.app;

const waveDataDir = getWaveDataDir();
const waveConfigDir = getWaveConfigDir();

// Native theme is set dynamically in appMain() based on app:theme setting

console.log = log;
console.log(
    sprintf(
        "waveterm-app starting, data_dir=%s, config_dir=%s electronpath=%s gopath=%s arch=%s/%s electron=%s",
        waveDataDir,
        waveConfigDir,
        getElectronAppBasePath(),
        getElectronAppUnpackedBasePath(),
        unamePlatform,
        unameArch,
        process.versions.electron
    )
);
if (isDev) {
    console.log("waveterm-app WAVETERM_DEV set");
}

function handleWSEvent(evtMsg: WSEventType) {
    fireAndForget(async () => {
        console.log("handleWSEvent", evtMsg?.eventtype);
        if (evtMsg.eventtype == "electron:newwindow") {
            console.log("electron:newwindow", evtMsg.data);
            const windowId: string = evtMsg.data;
            const windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
            if (windowData == null) {
                return;
            }
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            const newWin = await createBrowserWindow(windowData, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
            newWin.show();
        } else if (evtMsg.eventtype == "electron:closewindow") {
            console.log("electron:closewindow", evtMsg.data);
            if (evtMsg.data === undefined) return;
            const ww = getWaveWindowById(evtMsg.data);
            if (ww != null) {
                ww.destroy(); // bypass the "are you sure?" dialog
            }
        } else if (evtMsg.eventtype == "electron:updateactivetab") {
            const activeTabUpdate: { workspaceid: string; newactivetabid: string } = evtMsg.data;
            console.log("electron:updateactivetab", activeTabUpdate);
            const ww = getWaveWindowByWorkspaceId(activeTabUpdate.workspaceid);
            if (ww == null) {
                return;
            }
            await ww.setActiveTab(activeTabUpdate.newactivetabid, false);
        } else {
            console.log("unhandled electron ws eventtype", evtMsg.eventtype);
        }
    });
}

// we try to set the primary display as index [0]
function getActivityDisplays(): ActivityDisplayType[] {
    const displays = electron.screen.getAllDisplays();
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const rtn: ActivityDisplayType[] = [];
    for (const display of displays) {
        const adt = {
            width: display.size.width,
            height: display.size.height,
            dpr: display.scaleFactor,
            internal: display.internal,
        };
        if (display.id === primaryDisplay?.id) {
            rtn.unshift(adt);
        } else {
            rtn.push(adt);
        }
    }
    return rtn;
}

// Telemetry removed - sendDisplaysTDataEvent is now a no-op
async function sendDisplaysTDataEvent() {
    // No-op - telemetry has been removed from this fork
}

function logActiveState() {
    fireAndForget(async () => {
        const astate = getActivityState();
        const activity: ActivityUpdate = { openminutes: 1 };
        const ww = focusedWaveWindow;

        if (astate.wasInFg) {
            activity.fgminutes = 1;
        }
        if (astate.wasActive) {
            activity.activeminutes = 1;
        }
        activity.displays = getActivityDisplays();

        const termCmdCount = getAndClearTermCommandsRun();
        if (termCmdCount > 0) {
            activity.termcommandsrun = termCmdCount;
        }

        try {
            await RpcApi.ActivityCommand(ElectronWshClient, activity, { noresponse: true });
            // Telemetry removed - RecordTEventCommand calls have been removed from this fork
        } catch (e) {
            console.log("error logging active state", e);
        } finally {
            setWasInFg(ww?.isFocused() ?? false);
            setWasActive(false);
        }
    });
}

// this isn't perfect, but gets the job done without being complicated
function runActiveTimer() {
    logActiveState();
    setTimeout(runActiveTimer, 60000);
}

function hideWindowWithCatch(window: WaveBrowserWindow) {
    if (window == null) {
        return;
    }
    try {
        if (window.isDestroyed()) {
            return;
        }
        window.hide();
    } catch (e) {
        console.log("error hiding window", e);
    }
}

electronApp.on("window-all-closed", () => {
    if (getGlobalIsRelaunching()) {
        return;
    }
    if (unamePlatform !== "darwin") {
        electronApp.quit();
    }
});
electronApp.on("before-quit", (e) => {
    setGlobalIsQuitting(true);
    updater?.stop();
    if (unamePlatform == "win32") {
        // win32 doesn't have a SIGINT, so we just let electron die, which
        // ends up killing wavesrv via closing it's stdin.
        return;
    }
    getWaveSrvProc()?.kill("SIGINT");
    shutdownWshrpc();
    if (getForceQuit()) {
        return;
    }
    e.preventDefault();
    const allWindows = getAllWaveWindows();
    for (const window of allWindows) {
        hideWindowWithCatch(window);
    }
    if (getIsWaveSrvDead()) {
        console.log("wavesrv is dead, quitting immediately");
        setForceQuit(true);
        electronApp.quit();
        return;
    }
    setTimeout(() => {
        console.log("waiting for wavesrv to exit...");
        setForceQuit(true);
        electronApp.quit();
    }, 3000);
});
process.on("SIGINT", () => {
    console.log("Caught SIGINT, shutting down");
    electronApp.quit();
});
process.on("SIGHUP", () => {
    console.log("Caught SIGHUP, shutting down");
    electronApp.quit();
});
process.on("SIGTERM", () => {
    console.log("Caught SIGTERM, shutting down");
    electronApp.quit();
});
let caughtException = false;
process.on("uncaughtException", (error) => {
    if (caughtException) {
        return;
    }

    // Check if the error is related to QUIC protocol, if so, ignore (can happen with the updater)
    if (error?.message?.includes("net::ERR_QUIC_PROTOCOL_ERROR")) {
        console.log("Ignoring QUIC protocol error:", error.message);
        console.log("Stack Trace:", error.stack);
        return;
    }

    caughtException = true;
    console.log("Uncaught Exception, shutting down: ", error);
    console.log("Stack Trace:", error.stack);
    // Optionally, handle cleanup or exit the app
    electronApp.quit();
});

let lastWaveWindowCount = 0;
globalEvents.on("windows-updated", () => {
    const wwCount = getAllWaveWindows().length;
    if (wwCount == lastWaveWindowCount) {
        return;
    }
    lastWaveWindowCount = wwCount;
    console.log("windows-updated", wwCount);
    makeAndSetAppMenu();
});

async function appMain() {
    // Set disableHardwareAcceleration as early as possible, if required.
    const launchSettings = getLaunchSettings();
    if (launchSettings?.["window:disablehardwareacceleration"]) {
        console.log("disabling hardware acceleration, per launch settings");
        electronApp.disableHardwareAcceleration();
    }
    const startTs = Date.now();
    const instanceLock = electronApp.requestSingleInstanceLock();
    if (!instanceLock) {
        console.log("waveterm-app could not get single-instance-lock, shutting down");
        electronApp.quit();
        return;
    }
    try {
        await runWaveSrv(handleWSEvent);
    } catch (e) {
        console.log(e.toString());
    }
    const ready = await getWaveSrvReady();
    console.log("wavesrv ready signal received", ready, Date.now() - startTs, "ms");
    await electronApp.whenReady();
    configureAuthKeyRequestInjection(electron.session.defaultSession);
    initIpcHandlers();

    await sleep(10); // wait a bit for wavesrv to be ready
    try {
        initElectronWshClient();
        initElectronWshrpc(ElectronWshClient, { authKey: AuthKey });
        initMenuEventSubscriptions();
    } catch (e) {
        console.log("error initializing wshrpc", e);
    }
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);

    // Set native theme based on app:theme setting
    const appTheme = fullConfig?.settings?.["app:theme"] ?? "dark";
    if (appTheme === "system" || appTheme === "light" || appTheme === "dark") {
        electron.nativeTheme.themeSource = appTheme;
    } else {
        electron.nativeTheme.themeSource = "dark";
    }

    checkIfRunningUnderARM64Translation(fullConfig);
    ensureHotSpareTab(fullConfig);
    await relaunchBrowserWindows();
    setTimeout(runActiveTimer, 5000); // start active timer, wait 5s just to be safe
    setTimeout(sendDisplaysTDataEvent, 5000);

    makeAndSetAppMenu();
    makeDockTaskbar();
    await configureAutoUpdater();
    setGlobalIsStarting(false);
    if (fullConfig?.settings?.["window:maxtabcachesize"] != null) {
        setMaxTabCacheSize(fullConfig.settings["window:maxtabcachesize"]);
    }

    electronApp.on("activate", () => {
        const allWindows = getAllWaveWindows();
        if (allWindows.length === 0) {
            fireAndForget(createNewWaveWindow);
        }
    });
    const rawGlobalHotKey = launchSettings?.["app:globalhotkey"];
    if (rawGlobalHotKey) {
        registerGlobalHotkey(rawGlobalHotKey);
    }
}

appMain().catch((e) => {
    console.log("appMain error", e);
    electronApp.quit();
});
