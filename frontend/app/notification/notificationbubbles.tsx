// NotificationBubbles.tsx

import "./notificationBubbles.less"; // Create a CSS file for NotificationBubbles styles
import { NotificationItem } from "./notificationitem";
import { useNotification } from "./usenotification";

const NotificationBubbles = () => {
    const { notifications, removeNotification, copyNotification, handleActionClick, formatTimestamp } =
        useNotification();

    return (
        <div className="notification-bubbles">
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
    );
};

export { NotificationBubbles };
