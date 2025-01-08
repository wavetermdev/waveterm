// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { UserList } from "./userlist";

import "./userlist.scss";

export interface UserStatus {
    text: string;
    status: "online" | "busy" | "away" | "offline";
    onClick: () => void;
}

const meta = {
    title: "Elements/UserList",
    component: UserList,
    args: {
        users: [
            {
                label: "John Doe",
                status: "online",
                onClick: () => console.log("John Doe clicked"),
            },
            {
                label: "Jane Smith",
                status: "busy",
                onClick: () => console.log("Jane Smith clicked"),
            },
            {
                label: "Robert Brown",
                status: "away",
                onClick: () => console.log("Robert Brown clicked"),
            },
            {
                label: "Alice Lambert",
                status: "offline",
                onClick: () => console.log("Alice Lambert clicked"),
            },
        ],
    },
    argTypes: {
        users: {
            description: "Array of user statuses to be displayed",
        },
    },
} satisfies Meta<typeof UserList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: (args) => (
        <div>
            <UserList {...args} />
        </div>
    ),
};
