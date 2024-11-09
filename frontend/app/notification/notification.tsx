import { atom, useAtomValue } from "jotai";
import { NotificationBubbles } from "./notificationbubbles";
import { NotificationPopover } from "./notificationpopover";

import "./notification.less";

const notificationModeAtom = atom<"popover">();

const Notification = () => {
    const notificationMode = useAtomValue(notificationModeAtom);

    if (notificationMode === "popover") {
        return <NotificationPopover />;
    }
    return <NotificationBubbles />;
};

export { Notification, notificationModeAtom };
