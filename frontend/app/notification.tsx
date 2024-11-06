// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { atoms, getApi } from "@/store/global";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom } from "jotai";
import { Fragment, ReactNode, useState } from "react";

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

    const convertNewlinesToBreaks = (text: string): ReactNode => {
        return text.split("\n").map((part, index) => (
            <Fragment key={index}>
                {part}
                <br />
            </Fragment>
        ));
    };

    return (
        <div className="notification-container">
            <Button className="ghost grey" onClick={removeAllNotifications}>
                Close All
            </Button>
            {notifications.map((notif) => (
                <div
                    key={notif.id}
                    className={clsx("notification", notif.color, {
                        hovered: hoveredId === notif.id,
                    })}
                    onMouseEnter={() => setHoveredId(notif.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    title="Click to Copy Notification Message"
                >
                    <Button
                        className="close-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(notif.id);
                        }}
                        aria-label="Close"
                    >
                        <i className={makeIconClass("close", false)}></i>
                    </Button>
                    <div className="notification-scroll" onClick={() => copyNotification(notif.id)}>
                        {notif.icon && (
                            <span className="notification-icon">
                                <i className={makeIconClass(notif.icon, false)}></i>
                            </span>
                        )}
                        {notif.title && <div className="notification-title">{notif.title}</div>}
                        {notif.timestamp && <div className="notification-timestamp">{notif.timestamp}</div>}
                        {notif.message && (
                            <div className="notification-message">{convertNewlinesToBreaks(notif.message)}</div>
                        )}
                    </div>
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
            ))}
        </div>
    );
};

Notification.displayName = "Notification";

export { Notification };
