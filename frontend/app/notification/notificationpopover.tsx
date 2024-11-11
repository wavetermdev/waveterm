import { Button } from "@/element/button";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { atoms } from "@/store/global";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Fragment, useCallback } from "react";
import { NotificationItem } from "./notificationitem";
import { useNotification } from "./usenotification";

import "./notificationpopover.less";

const NotificationPopover = () => {
    const {
        notifications,
        removeNotification,
        hideAllNotifications,
        removeAllNotifications,
        copyNotification,
        handleActionClick,
        formatTimestamp,
        hoveredId,
        setHoveredId,
    } = useNotification();
    const [notificationPopoverMode, setNotificationPopoverMode] = useAtom(atoms.notificationPopoverMode);

    const handleTogglePopover = useCallback(() => {
        setNotificationPopoverMode(!notificationPopoverMode);
        hideAllNotifications();
    }, [notificationPopoverMode]);

    const hasErrors = notifications.some((n) => n.color === "red");
    const hasUpdate = notifications.some((n) => n.title.includes("Update"));

    const addOnClassNames = hasUpdate ? "solid green" : hasErrors ? "solid red" : "ghost grey";

    const getIcon = () => {
        if (hasUpdate) {
            return <i className={makeIconClass("arrows-rotate", false)}></i>;
        }
        return <i className={makeIconClass("bell", false)}></i>;
    };

    return (
        <Popover className="notification-popover" placement="left-end" offset={{ mainAxis: 20, crossAxis: 2 }}>
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
