// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./avatar";

const meta = {
    title: "Elements/Avatar",
    component: Avatar,
    args: {
        name: "John Doe",
        status: "offline",
        imageUrl: "",
    },
    argTypes: {
        name: {
            control: { type: "text" },
            description: "The name of the user",
        },
        status: {
            control: { type: "select", options: ["online", "offline", "busy", "away"] },
            description: "The status of the user",
        },
        imageUrl: {
            control: { type: "text" },
            description: "Optional image URL for the avatar",
        },
    },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default case (without an image, default status: offline)
export const Default: Story = {
    args: {
        name: "John Doe",
        status: "offline",
        imageUrl: "",
    },
};

// Online status with an image
export const OnlineWithImage: Story = {
    args: {
        name: "Alice Smith",
        status: "online",
        imageUrl: "https://i.pravatar.cc/150?u=a042581f4e29026704d",
    },
};

// Busy status without an image
export const BusyWithoutImage: Story = {
    args: {
        name: "Michael Johnson",
        status: "busy",
        imageUrl: "",
    },
};

// Away status with an image
export const AwayWithImage: Story = {
    args: {
        name: "Sarah Connor",
        status: "away",
        imageUrl: "https://i.pravatar.cc/150?u=a042581f4e29026704d",
    },
};
