import { FloatingPortal, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { useEffect, useState } from "react";
import { NotificationItem } from "./notificationitem";
import { useNotification } from "./usenotification";

import "./notificationBubbles.less";

const NotificationBubbles = () => {
    const { notifications, removeNotification, copyNotification, handleActionClick, formatTimestamp } =
        useNotification();
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

    if (!isOpen) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                className="notification-bubbles"
                {...getFloatingProps({
                    onClick: (e) => e.stopPropagation(),
                })}
            >
                {notifications.map((notif) => (
                    <NotificationItem
                        key={notif.id}
                        notification={notif}
                        onRemove={removeNotification}
                        onCopy={copyNotification}
                        onActionClick={handleActionClick}
                        formatTimestamp={formatTimestamp}
                        isBubble={true}
                    />
                ))}
            </div>
        </FloatingPortal>
    );
};

export { NotificationBubbles };
