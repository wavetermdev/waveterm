// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { atoms, getApi } from "@/store/global";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom } from "jotai";
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

    return (
        <div className="notification-container">
            <div className="header">
                <span>Notification</span>
                <Button className="ghost grey" onClick={removeAllNotifications}>
                    Close All
                </Button>
            </div>
            <div className="divider"></div>
            {notifications.map((notif, index) => (
                <Fragment key={notif.id}>
                    <div
                        className={clsx("notification", {
                            hovered: hoveredId === notif.id,
                        })}
                        onMouseEnter={() => setHoveredId(notif.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        title="Click to Copy Notification Message"
                    >
                        <Button
                            className="close-btn ghost grey"
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
                                    <i className={makeIconClass(notif.icon, false)}></i>
                                </div>
                            )}
                            <div className="notification-text">
                                {notif.title && <div className="notification-title">{notif.title}</div>}
                                {notif.timestamp && <div className="notification-timestamp">{notif.timestamp}</div>}
                                {notif.message && <div className="notification-message">{notif.message}</div>}
                                <div className="notification-actions">
                                    {notif.actions?.map((action, index) => {
                                        const actionFn = notificationActions[action.actionKey];
                                        return (
                                            <Button
                                                key={index}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (actionFn) actionFn();
                                                }}
                                                className={action.color}
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
        </div>
    );
};

Notification.displayName = "Notification";

export { Notification };
