// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isDev } from "@/util/isdev";
import * as electron from "electron";
import { autoUpdater } from "electron-updater";
import * as services from "../frontend/app/store/services";
import { fireAndForget } from "../frontend/util/util";

export let updater: Updater;

export class Updater {
    autoCheckInterval: NodeJS.Timeout | null;
    intervalms: number;
    autoCheckEnabled: boolean;
    availableUpdateReleaseName: string | null;
    availableUpdateReleaseNotes: string | null;
    private _status: UpdaterStatus;
    lastUpdateCheck: Date;

    constructor(settings: SettingsType) {
        this.intervalms = settings["autoupdate:intervalms"];
        this.autoCheckEnabled = settings["autoupdate:enabled"];

        this._status = "up-to-date";
        this.lastUpdateCheck = new Date(0);
        this.autoCheckInterval = null;
        this.availableUpdateReleaseName = null;

        autoUpdater.autoInstallOnAppQuit = settings["autoupdate:installonquit"];

        autoUpdater.removeAllListeners();

        autoUpdater.on("error", (err) => {
            console.log("updater error");
            console.log(err);
            this.status = "error";
        });

        autoUpdater.on("checking-for-update", () => {
            console.log("checking-for-update");
            this.status = "checking";
        });

        autoUpdater.on("update-available", () => {
            console.log("update-available; downloading...");
        });

        autoUpdater.on("update-not-available", () => {
            console.log("update-not-available");
        });

        autoUpdater.on("update-downloaded", (event) => {
            console.log("update-downloaded", [event]);
            this.availableUpdateReleaseName = event.releaseName;
            this.availableUpdateReleaseNotes = event.releaseNotes as string | null;

            // Display the update banner and create a system notification
            this.status = "ready";
            const updateNotification = new electron.Notification({
                title: "Wave Terminal",
                body: "A new version of Wave Terminal is ready to install.",
            });
            updateNotification.on("click", () => {
                fireAndForget(() => this.promptToInstallUpdate());
            });
            updateNotification.show();
        });
    }

    /**
     * The status of the Updater.
     */
    get status(): UpdaterStatus {
        return this._status;
    }

    private set status(value: UpdaterStatus) {
        this._status = value;
        electron.BrowserWindow.getAllWindows().forEach((window) => {
            window.webContents.send("app-update-status", value);
        });
    }

    /**
     * Check for updates and start the background update check, if configured.
     */
    async start() {
        if (this.autoCheckEnabled) {
            console.log("starting updater");
            this.autoCheckInterval = setInterval(() => {
                fireAndForget(() => this.checkForUpdates(false));
            }, 600000); // intervals are unreliable when an app is suspended so we will check every 10 mins if the interval has passed.
            await this.checkForUpdates(false);
        }
    }

    /**
     * Stop the background update check, if configured.
     */
    stop() {
        console.log("stopping updater");
        if (this.autoCheckInterval) {
            clearInterval(this.autoCheckInterval);
            this.autoCheckInterval = null;
        }
    }

    /**
     * Checks if the configured interval time has passed since the last update check, and if so, checks for updates using the `autoUpdater` object
     * @param userInput Whether the user is requesting this. If so, an alert will report the result of the check.
     */
    async checkForUpdates(userInput: boolean) {
        const now = new Date();

        // Run an update check always if the user requests it, otherwise only if there's an active update check interval and enough time has elapsed.
        if (
            userInput ||
            (this.autoCheckInterval &&
                (!this.lastUpdateCheck || Math.abs(now.getTime() - this.lastUpdateCheck.getTime()) > this.intervalms))
        ) {
            const result = await autoUpdater.checkForUpdates();

            // If the user requested this check and we do not have an available update, let them know with a popup dialog. No need to tell them if there is an update, because we show a banner once the update is ready to install.
            if (userInput && !result.downloadPromise) {
                const dialogOpts: Electron.MessageBoxOptions = {
                    type: "info",
                    message: "There are currently no updates available.",
                };
                electron.dialog.showMessageBox(electron.BrowserWindow.getFocusedWindow(), dialogOpts);
            }

            // Only update the last check time if this is an automatic check. This ensures the interval remains consistent.
            if (!userInput) this.lastUpdateCheck = now;
        }
    }

    /**
     * Prompts the user to install the downloaded application update and restarts the application
     */
    async promptToInstallUpdate() {
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            buttons: ["Restart", "Later"],
            title: "Application Update",
            message: process.platform === "win32" ? this.availableUpdateReleaseNotes : this.availableUpdateReleaseName,
            detail: "A new version has been downloaded. Restart the application to apply the updates.",
        };

        const allWindows = electron.BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
            await electron.dialog
                .showMessageBox(electron.BrowserWindow.getFocusedWindow() ?? allWindows[0], dialogOpts)
                .then(({ response }) => {
                    if (response === 0) {
                        this.installUpdate();
                    }
                });
        }
    }

    /**
     * Restarts the app and installs an update if it is available.
     */
    installUpdate() {
        if (this.status == "ready") {
            this.status = "installing";
            autoUpdater.quitAndInstall();
        }
    }
}

electron.ipcMain.on("install-app-update", () => fireAndForget(() => updater?.promptToInstallUpdate()));
electron.ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = updater?.status;
});

let autoUpdateLock = false;

/**
 * Configures the auto-updater based on the user's preference
 */
export async function configureAutoUpdater() {
    if (isDev()) {
        console.log("skipping auto-updater in dev mode");
        return;
    }

    // simple lock to prevent multiple auto-update configuration attempts, this should be very rare
    if (autoUpdateLock) {
        console.log("auto-update configuration already in progress, skipping");
        return;
    }
    autoUpdateLock = true;

    try {
        console.log("Configuring updater");
        const settings = (await services.FileService.GetFullConfig()).settings;
        updater = new Updater(settings);
        await updater.start();
    } catch (e) {
        console.warn("error configuring updater", e.toString());
    }

    autoUpdateLock = false;
}
