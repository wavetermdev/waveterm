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
            className="w-full pb-2 pt-1 pl-0 pr-0.5 flex items-center justify-center"
            placement="left-end"
            offset={{ mainAxis: 20, crossAxis: 2 }}
            onDismiss={handleTogglePopover}
        >
            <PopoverButton
                className={clsx(
                    "w-[27px] h-[26px] flex justify-center [&>i]:text-[17px] px-[6px] py-[4px]",
                    addOnClassNames
                )}
                disabled={notifications.length === 0}
                onClick={handleTogglePopover}
            >
                {getIcon()}
            </PopoverButton>
            {notifications.length > 0 && (
                <PopoverContent className="flex w-[380px] pt-2.5 pb-0 px-0 flex-col items-start gap-x-2 rounded-lg border-[0.5px] border-white/12 bg-[#232323] shadow-[0px_8px_32px_0px_rgba(0,0,0,0.25)]">
                    <div className="flex items-center justify-between w-full px-2.5 pb-2 border-b border-white/8">
                        <span className="text-foreground text-sm font-semibold leading-4">Notifications</span>
                        <Button
                            className="ghost grey text-[13px] font-normal leading-4 text-white/40 px-[3px] py-[3px]"
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
                                {index !== notifications.length - 1 && <div className="bg-white/8 h-px w-full"></div>}
                            </Fragment>
                        ))}
                    </OverlayScrollbarsComponent>
                </PopoverContent>
            )}
        </Popover>
    );
};

export { NotificationPopover };
