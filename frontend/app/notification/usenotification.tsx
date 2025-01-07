// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi } from "@/store/global";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";

const notificationActions: { [key: string]: () => void } = {
    installUpdate: () => {
        getApi().installAppUpdate();
    },
    // Add other action functions here
};

export function useNotification() {
    const notificationPopoverMode = useAtomValue(atoms.notificationPopoverMode);
    const [notifications, setNotifications] = useAtom(atoms.notifications);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const removeNotification = useCallback(
        (id: string) => {
            setNotifications((prevNotifications) => prevNotifications.filter((n) => n.id !== id));
        },
        [setNotifications]
    );

    const hideNotification = useCallback(
        (id: string) => {
            setNotifications((prevNotifications) =>
                prevNotifications.map((n) => (n.id === id ? { ...n, hidden: true } : n))
            );
        },
        [setNotifications]
    );

    const hideAllNotifications = useCallback(() => {
        setNotifications((prevNotifications) => prevNotifications.map((n) => ({ ...n, hidden: true })));
    }, [setNotifications]);

    const removeAllNotifications = useCallback(() => {
        setNotifications((prevNotifications) => prevNotifications.filter((n) => n.persistent));
    }, [setNotifications]);

    const copyNotification = useCallback(
        (id: string) => {
            const notif = notifications.find((n) => n.id === id);
            if (!notif) return;

            let text = notif.title ?? "";
            if (notif.message) {
                text += text.length > 0 ? `\n${notif.message}` : notif.message;
            }
            navigator.clipboard
                .writeText(text)
                .then(() => {
                    console.info("Text copied to clipboard");
                })
                .catch((err) => {
                    console.error("Failed to copy text: ", err);
                });
        },
        [notifications]
    );

    const handleActionClick = useCallback(
        (e: React.MouseEvent, action: NotificationActionType, id: string) => {
            e.stopPropagation();
            const actionFn = notificationActions[action.actionKey];
            if (actionFn) {
                actionFn();
                removeNotification(id);
            } else {
                console.warn(`No action found for key: ${action.actionKey}`);
            }
        },
        [removeNotification]
    );

    useEffect(() => {
        if (notificationPopoverMode) {
            return;
        }

        const hasExpiringNotifications = notifications.some((notif) => notif.expiration);
        if (!hasExpiringNotifications) {
            return;
        }

        const intervalId = setInterval(() => {
            const now = Date.now();

            setNotifications((prevNotifications) =>
                prevNotifications.filter(
                    (notif) => !notif.expiration || notif.expiration > now || notif.id === hoveredId
                )
            );
        }, 1000);

        return () => clearInterval(intervalId);
    }, [notificationPopoverMode, notifications, hoveredId, setNotifications]);

    const formatTimestamp = (timestamp: string): string => {
        const notificationTime = new Date(timestamp).getTime();
        const now = Date.now();
        const diffInSeconds = Math.floor((now - notificationTime) / 1000);
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        const diffInHours = Math.floor(diffInMinutes / 60);
        const diffInDays = Math.floor(diffInHours / 24);

        if (diffInMinutes === 0) {
            return `Just now`;
        } else if (diffInMinutes < 60) {
            return `${diffInMinutes} mins ago`;
        } else if (diffInHours < 24) {
            return `${diffInHours} hrs ago`;
        } else if (diffInDays < 7) {
            return `${diffInDays} days ago`;
        } else {
            return new Date(timestamp).toLocaleString();
        }
    };

    return {
        notifications,
        hoveredId,
        setHoveredId,
        removeNotification,
        removeAllNotifications,
        hideNotification,
        hideAllNotifications,
        copyNotification,
        handleActionClick,
        formatTimestamp,
    };
}
