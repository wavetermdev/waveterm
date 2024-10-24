// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessages } from "./chatmessages";
import "./chatmessages.less";

export interface ChatMessage {
    id: string;
    username: string;
    message: string;
    color?: string;
    userIcon?: string;
    messageIcon?: string;
}

const meta = {
    title: "Elements/ChatMessages",
    component: ChatMessages,
    args: {
        messages: [
            {
                id: "1",
                username: "User1",
                message: "Hello everyone! 👋",
                color: "#ff4500",
                userIcon: "https://via.placeholder.com/50",
            },
            {
                id: "2",
                username: "User2",
                message: "Check this out: ![cool icon](https://via.placeholder.com/20)",
                color: "#1e90ff",
            },
            {
                id: "3",
                username: "User3",
                message: "This is a simple text message without icons.",
                color: "#32cd32",
                userIcon: "https://via.placeholder.com/50",
            },
            {
                id: "4",
                username: "User4",
                message: "🎉 👏 Great job!",
                color: "#ff6347",
            },
            {
                id: "5",
                username: "User5",
                message: "Look at this cool icon: Isn't it awesome? ![cool icon](https://via.placeholder.com/20)",
                color: "#8a2be2",
                userIcon: "https://via.placeholder.com/50",
            },
        ],
    },
    argTypes: {
        messages: {
            description: "Array of chat messages to be displayed",
        },
    },
} satisfies Meta<typeof ChatMessages>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Messages: Story = {
    render: (args) => (
        <div>
            <ChatMessages {...args} />
        </div>
    ),
};

export const ScrollableMessages: Story = {
    render: (args) => (
        <div style={{ height: "100%", overflow: "hidden" }}>
            <ChatMessages {...args} />
        </div>
    ),
    args: {
        messages: Array.from({ length: 50 }, (_, i) => ({
            id: `${i + 1}`,
            username: `User${i + 1}`,
            message: `This is message number ${i + 1}.`,
            color: i % 2 === 0 ? "#ff6347" : "#1e90ff",
            userIcon: "https://via.placeholder.com/50",
        })),
    },
};
