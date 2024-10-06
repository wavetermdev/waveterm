// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { memo } from "react";
import { Avatar } from "./avatar";
import "./userlist.less";

export interface UserStatus {
    text: string;
    status: "online" | "busy" | "away" | "offline";
    onClick: () => void;
}

interface UserListProps {
    users: UserStatus[];
    className?: string;
}

const UserList = memo(({ users, className }: UserListProps) => {
    return (
        <div className={clsx("user-list", className)}>
            {users.map(({ text, status, onClick }, index) => (
                <div key={index} className={clsx("user-status-item", status)} onClick={onClick}>
                    <div className="user-status-icon">
                        <Avatar name={text} status={status} className="size-sm" />
                    </div>
                    <div className="user-status-text">{text}</div>
                </div>
            ))}
        </div>
    );
});

UserList.displayName = "UserList";

export { UserList };
