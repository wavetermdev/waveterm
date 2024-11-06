// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { atoms, getApi } from "@/store/global";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Fragment, useState } from "react";

import "./notification.less";

const notificationActions = {
    installUpdate: () => {
        getApi().installAppUpdate();
    },
    retryUpdate: () => {
        getApi().installAppUpdate();
    },
};

const Notification = () => {
    const [notifications, setNotifications] = useAtom(atoms.notifications);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    if (notifications.length === 0) {
        return null;
    }

    const removeNotification = (id: string) => {
        setNotifications((prevNotifications) => prevNotifications.filter((n) => n.id !== id));
    };

    const removeAllNotifications = () => {
        setNotifications([]);
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

    const formatTimestamp = (timestamp: string): string => {
        const notificationTime = new Date(timestamp).getTime();
        const now = Date.now();
        const diffInSeconds = Math.floor((now - notificationTime) / 1000);
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        const diffInHours = Math.floor(diffInMinutes / 60);
        const diffInDays = Math.floor(diffInHours / 24);

        if (diffInMinutes == 0) {
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

    return (
        <div className="notification-container">
            <div className="header">
                <span>Notifications</span>
                <Button
                    className="ghost grey close-all-btn horizontal-padding-3 vertical-padding-3"
                    onClick={removeAllNotifications}
                >
                    Close All
                </Button>
            </div>
            <OverlayScrollbarsComponent
                className="scrollable"
                options={{ scrollbars: { autoHide: "leave" } }}
                style={{ maxHeight: window.innerHeight / 2 }}
            >
                {notifications.map((notif, index) => (
                    <Fragment key={notif.id}>
                        <div
                            className={clsx("notification", {
                                hovered: hoveredId === notif.id,
                            })}
                            onMouseEnter={() => setHoveredId(notif.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            onClick={() => copyNotification(notif.id)}
                            title="Click to Copy Notification Message"
                        >
                            <Button
                                className="close-btn ghost grey vertical-padding-10"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeNotification(notif.id);
                                }}
                                aria-label="Close"
                            >
                                <i className={makeIconClass("close", false)}></i>
                            </Button>
                            <div className="notification-inner">
                                {notif.icon && (
                                    <div className="notification-icon">
                                        <i className={clsx(makeIconClass(notif.icon, false), notif.color)}></i>
                                    </div>
                                )}
                                <div className="notification-text">
                                    {notif.title && <div className="notification-title">{notif.title}</div>}
                                    {notif.timestamp && (
                                        <div className="notification-timestamp">{formatTimestamp(notif.timestamp)}</div>
                                    )}
                                    {notif.message && <div className="notification-message">{notif.message}</div>}
                                    <div className="notification-actions">
                                        {notif.actions?.map((action, index) => {
                                            const actionFn = notificationActions[action.actionKey];
                                            return (
                                                <Button
                                                    key={index}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        actionFn?.();
                                                    }}
                                                    className={clsx(
                                                        action.color,
                                                        "vertical-padding-4 horizontal-padding-8 font-size-13 border-radius-4"
                                                    )}
                                                    disabled={action.disabled}
                                                >
                                                    {action.label}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                        {index !== notifications.length - 1 && <div className="divider"></div>}
                    </Fragment>
                ))}
            </OverlayScrollbarsComponent>
        </div>
    );
};

Notification.displayName = "Notification";

export { Notification };
