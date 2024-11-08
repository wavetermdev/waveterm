import { atoms, getApi } from "@/store/global";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";

const notificationActions: { [key: string]: () => void } = {
    installUpdate: () => {
        getApi().installAppUpdate();
    },
    // Add other action functions here
};

export function useNotification() {
    const [notifications, setNotifications] = useAtom(atoms.notifications);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [ticker, setTicker] = useState<number>(0);

    useEffect(() => {
        if (notifications.length === 0 || hoveredId != null) {
            return;
        }
        const now = Date.now();
        for (let notif of notifications) {
            if (notif.expiration && notif.expiration < now) {
                removeNotification(notif.id);
            }
        }
        const timeout = setTimeout(() => setTicker(ticker + 1), 1000);
        return () => clearTimeout(timeout);
    }, [notifications, ticker, hoveredId]);

    const removeNotification = (id: string) => {
        setNotifications((prevNotifications) => prevNotifications.filter((n) => n.id !== id));
    };

    const removeAllNotifications = () => {
        setNotifications((prevNotifications) => prevNotifications.filter((n) => n.persistent));
    };

    const copyNotification = (id: string) => {
        const notif = notifications.find((n) => n.id === id);
        if (!notif) return;

        let text = notif.title ?? "";
        if (notif.message) {
            text += text.length > 0 ? `\n${notif.message}` : notif.message;
        }
        navigator.clipboard.writeText(text);
    };

    const handleActionClick = (e: React.MouseEvent, action: NotificationActionType, id: string) => {
        e.stopPropagation();
        const actionFn = notificationActions[action.actionKey];
        actionFn?.();
        removeNotification(id);
    };

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
        copyNotification,
        handleActionClick,
        formatTimestamp,
    };
}
