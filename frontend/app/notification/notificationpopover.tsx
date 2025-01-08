// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { atoms } from "@/store/global";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Fragment, useCallback } from "react";
import { NotificationItem } from "./notificationitem";
import { useUpdateNotifier } from "./updatenotifier";
import { useNotification } from "./usenotification";

import "./notificationpopover.scss";

const NotificationPopover = () => {
    useUpdateNotifier();
    const {
        notifications,
        removeNotification,
        removeAllNotifications,
        hideAllNotifications,
        copyNotification,
        handleActionClick,
        formatTimestamp,
        hoveredId,
        setHoveredId,
    } = useNotification();
    const [notificationPopoverMode, setNotificationPopoverMode] = useAtom(atoms.notificationPopoverMode);

    const handleTogglePopover = useCallback(() => {
        if (notificationPopoverMode) {
            hideAllNotifications();
        }
        setNotificationPopoverMode(!notificationPopoverMode);
    }, [notificationPopoverMode]);

    const hasErrors = notifications.some((n) => n.type === "error");
    const hasUpdate = notifications.some((n) => n.type === "update");

    const addOnClassNames = hasUpdate ? "solid green" : hasErrors ? "solid red" : "ghost grey";

    const getIcon = () => {
        if (hasUpdate) {
            return <i className={makeIconClass("arrows-rotate", false)}></i>;
        }
        return <i className={makeIconClass("bell", false)}></i>;
    };

    return (
        <Popover
            className="notification-popover"
            placement="left-end"
            offset={{ mainAxis: 20, crossAxis: 2 }}
            onDismiss={handleTogglePopover}
        >
            <PopoverButton
                className={clsx(
                    "notification-trigger-button horizontal-padding-6 vertical-padding-4 border-radius-",
                    addOnClassNames
                )}
                disabled={notifications.length === 0}
                onClick={handleTogglePopover}
            >
                {getIcon()}
            </PopoverButton>
            {notifications.length > 0 && (
                <PopoverContent className="notification-content">
                    <div className="header">
                        <span>Notifications</span>
                        <Button
                            className="ghost grey close-all-btn horizontal-padding-3 vertical-padding-3"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeAllNotifications();
                            }}
                        >
                            Clear
                        </Button>
                    </div>
                    <OverlayScrollbarsComponent
                        className="scrollable"
                        options={{ scrollbars: { autoHide: "leave" } }}
                        style={{ maxHeight: window.innerHeight / 2 }}
                    >
                        {notifications.map((notif, index) => (
                            <Fragment key={notif.id}>
                                <NotificationItem
                                    className={clsx({ hovered: hoveredId === notif.id })}
                                    notification={notif}
                                    onRemove={removeNotification}
                                    onCopy={copyNotification}
                                    onActionClick={handleActionClick}
                                    formatTimestamp={formatTimestamp}
                                    isBubble={false}
                                    onMouseEnter={() => setHoveredId(notif.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                />
                                {index !== notifications.length - 1 && <div className="divider"></div>}
                            </Fragment>
                        ))}
                    </OverlayScrollbarsComponent>
                </PopoverContent>
            )}
        </Popover>
    );
};

export { NotificationPopover };
