// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { memo } from "react";
import { Avatar } from "../../element/avatar";
import "./userlist.scss";

export interface UserStatus {
    label: string;
    status: "online" | "busy" | "away" | "offline";
    onClick: () => void;
    avatarUrl?: string;
}

interface UserListProps {
    users: UserStatus[];
    className?: string;
}

const UserList = memo(({ users, className }: UserListProps) => {
    return (
        <div className={clsx("user-list", className)}>
            {users.map(({ label, status, onClick, avatarUrl }, index) => (
                <div key={index} className={clsx("user-status-item", status)} onClick={onClick}>
                    <div className="user-status-icon">
                        <Avatar name={label} status={status} className="size-sm" imageUrl={avatarUrl} />
                    </div>
                    <div className="user-status-text">{label}</div>
                </div>
            ))}
        </div>
    );
});

UserList.displayName = "UserList";

export { UserList };
