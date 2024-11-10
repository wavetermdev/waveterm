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
        removeAllNotifications,
        copyNotification,
        handleActionClick,
        formatTimestamp,
        hoveredId,
        setHoveredId,
    } = useNotification();
    const [notificationMode, setNotificationMode] = useAtom(atoms.notificationMode);

    console.log("notificationMode**************", notificationMode);

    const handleTogglePopover = useCallback(() => {
        if (notificationMode === "popover") {
            setNotificationMode("bubbles");
        } else {
            setNotificationMode("popover");
        }
    }, [notificationMode]);

    return (
        <Popover className="notification-popover" placement="left-end" offset={10}>
            <PopoverButton
                className="notification-trigger-button horizontal-padding-6 vertical-padding-4 border-radius-6"
                onClick={handleTogglePopover}
            >
                <i className={makeIconClass("bell", false)}></i>
                {notifications.length > 0 && <span className="notification-count">{notifications.length}</span>}
            </PopoverButton>
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
        </Popover>
    );
};

export { NotificationPopover };
