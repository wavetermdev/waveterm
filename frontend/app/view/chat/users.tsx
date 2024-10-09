// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { Menu } from "@/app/element/menu";
import { UserStatus } from "@/app/element/userlist";

import "./users.less";

const Users = ({ users }: { users: UserStatus[] }) => {
    return <Menu className="user-list" items={users}></Menu>;
};

export { Users };
