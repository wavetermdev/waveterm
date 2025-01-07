// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, isDev, pushNotification } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

export const useUpdateNotifier = () => {
    const appUpdateStatus = useAtomValue(atoms.updaterStatusAtom);

    useEffect(() => {
        let notification: NotificationType | null = null;

        switch (appUpdateStatus) {
            case "ready":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: "Update Available",
                    message: "A new update is available and ready to be installed.",
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: "Install Now",
                            actionKey: "installUpdate",
                            color: "green",
                            disabled: false,
                        },
                    ],
                };
                break;

            case "downloading":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: "Downloading Update",
                    message: "The update is currently being downloaded.",
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: "Downloading...",
                            actionKey: "",
                            color: "green",
                            disabled: true,
                        },
                    ],
                };
                break;

            case "installing":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: "Installing Update",
                    message: "The update is currently being installed.",
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: "Installing...",
                            actionKey: "",
                            color: "green",
                            disabled: true,
                        },
                    ],
                };
                break;

            case "error":
                notification = {
                    id: "update-notification",
                    icon: "circle-exclamation",
                    title: "Update Error",
                    message: "An error occurred during the update process.",
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: "Retry Update",
                            actionKey: "retryUpdate",
                            color: "green",
                            disabled: false,
                        },
                    ],
                };
                break;
        }

        if (!isDev()) return;

        if (notification) {
            pushNotification(notification);
        }
    }, [appUpdateStatus]);
};
