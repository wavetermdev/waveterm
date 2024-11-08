// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { atoms, getApi } from "@/store/global";
import { makeIconClass } from "@/util/util";
import { FloatingPortal, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { useAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Fragment, useEffect, useState } from "react";

import "./notification.less";

const notificationActions = {
    installUpdate: () => {
        getApi().installAppUpdate();
    },
};

const NotificationList = () => {
    const [notifications, setNotifications] = useAtom(atoms.notifications);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [ticker, setTicker] = useState<number>(0);
    const [isOpen, setIsOpen] = useState(notifications.length > 0);

    useEffect(() => {
        setIsOpen(notifications.length > 0);
    }, [notifications.length]);

    const { refs, strategy, context } = useFloating({
        open: isOpen,
        onOpenChange: setIsOpen,
        strategy: "fixed",
    });

    const { getFloatingProps } = useInteractions([useDismiss(context)]);

    const floatingStyles = {
        position: strategy,
        right: "10px",
        bottom: "10px",
        top: "auto",
        left: "auto",
    };

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

    const handleActionClick = (e, actionFn, id) => {
        e.stopPropagation();
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

    if (!isOpen) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                className="notification-container"
                {...getFloatingProps({
                    onClick: (e) => e.stopPropagation(),
                })}
            >
                <div className="header">
                    <span>Notifications</span>
                    <Button
                        className="ghost grey close-all-btn horizontal-padding-3 vertical-padding-3"
                        onClick={(e) => {
                            e.stopPropagation();
                            removeAllNotifications();
                        }}
                    >
                        Clear All
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
                                {!notif.persistent && (
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
                                )}
                                <div className="notification-inner">
                                    {notif.icon && (
                                        <div className="notification-icon">
                                            <i className={clsx(makeIconClass(notif.icon, false), notif.color)}></i>
                                        </div>
                                    )}
                                    <div className="notification-text">
                                        {notif.title && <div className="notification-title">{notif.title}</div>}
                                        {notif.timestamp && (
                                            <div className="notification-timestamp">
                                                {formatTimestamp(notif.timestamp)}
                                            </div>
                                        )}
                                        {notif.message && <div className="notification-message">{notif.message}</div>}
                                        <div className="notification-actions">
                                            {notif.actions?.map((action, index) => {
                                                const actionFn = notificationActions[action.actionKey];
                                                return (
                                                    <Button
                                                        key={index}
                                                        onClick={(e) => handleActionClick(e, actionFn, notif.id)}
                                                        className={clsx(
                                                            action.color,
                                                            "vertical-padding-4 horizontal-padding-8 font-size-13 border-radius-4"
                                                        )}
                                                        disabled={action.disabled}
                                                    >
                                                        {action.label}
                                                        {action.rightIcon && (
                                                            <i className={makeIconClass(action.rightIcon, false)}></i>
                                                        )}
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
        </FloatingPortal>
    );
};

NotificationList.displayName = "NotificationList";

export { NotificationList };
