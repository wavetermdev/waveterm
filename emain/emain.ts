// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import * as electron from "electron";
import { focusedBuilderWindow, getAllBuilderWindows } from "emain/emain-builder";
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
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    setForceQuit,
    setGlobalIsQuitting,
    setGlobalIsStarting,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { initIpcHandlers } from "./emain-ipc";
import { log } from "./emain-log";
import { makeAndSetAppMenu, makeDockTaskbar } from "./emain-menu";
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

electron.nativeTheme.themeSource = "dark";

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

async function sendDisplaysTDataEvent() {
    const displays = getActivityDisplays();
    if (displays.length === 0) {
        return;
    }
    const props: TEventProps = {};
    props["display:count"] = displays.length;
    props["display:height"] = displays[0].height;
    props["display:width"] = displays[0].width;
    props["display:dpr"] = displays[0].dpr;
    props["display:all"] = displays;
    try {
        await RpcApi.RecordTEventCommand(
            ElectronWshClient,
            {
                event: "app:display",
                props,
            },
            { noresponse: true }
        );
    } catch (e) {
        console.log("error sending display tdata event", e);
    }
}

function logActiveState() {
    fireAndForget(async () => {
        const astate = getActivityState();
        const activity: ActivityUpdate = { openminutes: 1 };
        const ww = focusedWaveWindow;
        const activeTabView = ww?.activeTabView;
        const isWaveAIOpen = activeTabView?.isWaveAIOpen ?? false;

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

        const props: TEventProps = {
            "activity:activeminutes": activity.activeminutes,
            "activity:fgminutes": activity.fgminutes,
            "activity:openminutes": activity.openminutes,
        };
        if (termCmdCount > 0) {
            props["activity:termcommandsrun"] = termCmdCount;
        }
        if (astate.wasActive && isWaveAIOpen) {
            props["activity:waveaiactiveminutes"] = 1;
        }
        if (astate.wasInFg && isWaveAIOpen) {
            props["activity:waveaifgminutes"] = 1;
        }

        try {
            await RpcApi.ActivityCommand(ElectronWshClient, activity, { noresponse: true });
            await RpcApi.RecordTEventCommand(
                ElectronWshClient,
                {
                    event: "app:activity",
                    props,
                },
                { noresponse: true }
            );
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
    // If already confirmed and in quit process, run shutdown logic
    if (getGlobalIsQuitting()) {
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
        const allBuilders = getAllBuilderWindows();
        for (const builder of allBuilders) {
            builder.hide();
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
        return;
    }

    // First time through - check if confirmation needed
    e.preventDefault();
    fireAndForget(async () => {
        // Skip confirmation if RPC client not ready (early quit before app fully started)
        if (ElectronWshClient == null) {
            setGlobalIsQuitting(true);
            electronApp.quit();
            return;
        }
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        if (fullConfig.settings["app:confirmquit"]) {
            const choice = electron.dialog.showMessageBoxSync({
                type: "question",
                buttons: ["Cancel", "Quit"],
                title: "Confirm",
                message: "Quit Wave Terminal?",
            });
            if (choice === 0) {
                return; // User cancelled
            }
        }
        // User confirmed or setting disabled - proceed with quit
        setGlobalIsQuitting(true);
        electronApp.quit();
    });
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
let lastIsBuilderWindowActive = false;
globalEvents.on("windows-updated", () => {
    const wwCount = getAllWaveWindows().length;
    const isBuilderActive = focusedBuilderWindow != null;
    if (wwCount == lastWaveWindowCount && isBuilderActive == lastIsBuilderWindowActive) {
        return;
    }
    lastWaveWindowCount = wwCount;
    lastIsBuilderWindowActive = isBuilderActive;
    console.log("windows-updated", wwCount, "builder-active:", isBuilderActive);
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
    } catch (e) {
        console.log("error initializing wshrpc", e);
    }
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
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
