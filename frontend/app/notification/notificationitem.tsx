// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";

import "./notificationitem.scss";
interface NotificationItemProps {
    notification: NotificationType;
    onRemove: (id: string) => void;
    onCopy: (id: string) => void;
    onActionClick: (e: React.MouseEvent, action: NotificationActionType, id: string) => void;
    formatTimestamp: (timestamp: string) => string;
    isBubble: boolean;
    className?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}

const NotificationItem = ({
    notification,
    onRemove,
    onCopy,
    onActionClick,
    formatTimestamp,
    isBubble,
    className,
    onMouseEnter,
    onMouseLeave,
}: NotificationItemProps) => {
    const { id, title, message, icon, type, timestamp, persistent, actions } = notification;
    const color = type === "error" ? "red" : type === "warning" ? "yellow" : "green";
    const nIcon = icon ? icon : "bell";

    const renderCloseButton = () => {
        if (!isBubble && persistent) {
            return (
                <span className="lock-btn" title="Cannot be cleared">
                    <i className={makeIconClass("lock", false)}></i>
                </span>
            );
        }
        return (
            <Button
                className="close-btn ghost grey py-[10px]"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove(id);
                }}
                aria-label="Close"
            >
                <i className={clsx(makeIconClass("close", false), color)}></i>
            </Button>
        );
    };

    return (
        <div
            className={clsx(isBubble ? "notification-bubble" : "notification", className)}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={() => onCopy(id)}
            title="Click to Copy Notification Message"
        >
            {renderCloseButton()}
            <div className="notification-inner">
                {nIcon && (
                    <div className="notification-icon">
                        <i className={clsx(makeIconClass(nIcon, false), color)}></i>
                    </div>
                )}
                <div className="notification-text">
                    {title && <div className={clsx("notification-title", color)}>{title}</div>}
                    {timestamp && !isBubble && (
                        <div className="notification-timestamp">{formatTimestamp(timestamp)}</div>
                    )}
                    {message && <div className="notification-message">{message}</div>}
                    {actions && actions.length > 0 && (
                        <div className="notification-actions">
                            {actions.map((action, index) => (
                                <Button
                                    key={index}
                                    onClick={(e) => onActionClick(e, action, id)}
                                    className={clsx(
                                        action.color,
                                        "py-[4px] px-[8px] text-[13px] rounded-[4px]"
                                    )}
                                    disabled={action.disabled}
                                >
                                    {action.label}
                                    {action.rightIcon && <i className={makeIconClass(action.rightIcon, false)}></i>}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export { NotificationItem };
