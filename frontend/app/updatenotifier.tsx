// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/store/global";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

export function useUpdateNotifier() {
    const appUpdateStatus = useAtomValue(atoms.updaterStatusAtom);
    const setNotifications = useSetAtom(atoms.notifications);

    useEffect(() => {
        let notification: NotificationType | null = null;

        switch (appUpdateStatus) {
            case "ready":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: "Update Available",
                    message:
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
                    timestamp: new Date().toLocaleString(),
                    color: "green",
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
                    message:
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
                    timestamp: new Date().toLocaleString(),
                    color: "yellow",
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
                    message:
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
                    timestamp: new Date().toLocaleString(),
                    color: "yellow",
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
                    icon: "close",
                    title: "Update Error",
                    message: "An error occurred during the update process.",
                    timestamp: new Date().toLocaleString(),
                    color: "red",
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

            default:
                setNotifications((prev) => prev.filter((n) => n.id !== "update-notification"));
                return;
        }

        setNotifications((prev) => {
            const otherNotifications = prev.filter((n) => n.id !== "update-notification");
            return [...otherNotifications, notification!];
        });
    }, [appUpdateStatus, setNotifications]);
}
