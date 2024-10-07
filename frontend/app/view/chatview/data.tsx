// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { ChatMessage } from "@/app/element/chatmessages";
import { MenuItem } from "@/app/element/menu";
import { UserStatus } from "@/app/element/userlist";

export const channels: MenuItem[] = [
    {
        text: "Channel 1",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 1 clicked"),
    },
    {
        text: "Channel 2",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 2 clicked"),
        children: [
            {
                text: "Channel 2.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 2.1 clicked"),
                children: [
                    {
                        text: "Channel 2.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 2.1.1 clicked"),
                    },
                    {
                        text: "Channel 2.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 2.1.2 clicked"),
                    },
                ],
            },
            {
                text: "Channel 2.2",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 2.2 clicked"),
            },
        ],
    },
    {
        text: "Channel 3",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 3 clicked"),
        children: [
            {
                text: "Channel 3.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 3.1 clicked"),
            },
        ],
    },
    {
        text: "Channel 4",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 4 clicked"),
    },
    {
        text: "Channel 5",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 5 clicked"),
        children: [
            {
                text: "Channel 5.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 5.1 clicked"),
                children: [
                    {
                        text: "Channel 5.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 5.1.1 clicked"),
                    },
                    {
                        text: "Channel 5.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 5.1.2 clicked"),
                        children: [
                            {
                                text: "Channel 5.1.2.1",
                                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                                onClick: () => console.log("Channel 5.1.2.1 clicked"),
                            },
                        ],
                    },
                ],
            },
        ],
    },
    {
        text: "Channel 6",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 6 clicked"),
    },
    {
        text: "Channel 7",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 7 clicked"),
        children: [
            {
                text: "Channel 7.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 7.1 clicked"),
            },
        ],
    },
    {
        text: "Channel 8",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 8 clicked"),
    },
    {
        text: "Channel 9",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 9 clicked"),
        children: [
            {
                text: "Channel 9.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 9.1 clicked"),
                children: [
                    {
                        text: "Channel 9.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 9.1.1 clicked"),
                    },
                    {
                        text: "Channel 9.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 9.1.2 clicked"),
                    },
                ],
            },
        ],
    },
    {
        text: "Channel 10",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 10 clicked"),
    },
    {
        text: "Channel 11",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 11 clicked"),
    },
    {
        text: "Channel 12",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 12 clicked"),
    },
    {
        text: "Channel 13",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 13 clicked"),
    },
    {
        text: "Channel 14",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 14 clicked"),
        children: [
            {
                text: "Channel 14.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 14.1 clicked"),
            },
        ],
    },
    {
        text: "Channel 15",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 15 clicked"),
    },
    {
        text: "Channel 16",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 16 clicked"),
    },
    {
        text: "Channel 17",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 17 clicked"),
        children: [
            {
                text: "Channel 17.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 17.1 clicked"),
                children: [
                    {
                        text: "Channel 17.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 17.1.1 clicked"),
                    },
                    {
                        text: "Channel 17.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 17.1.2 clicked"),
                    },
                ],
            },
        ],
    },
    {
        text: "Channel 18",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 18 clicked"),
    },
    {
        text: "Channel 19",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 19 clicked"),
    },
    {
        text: "Channel 20",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 20 clicked"),
    },
    {
        text: "Channel 21",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 21 clicked"),
    },
    {
        text: "Channel 22",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 22 clicked"),
    },
    {
        text: "Channel 23",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 23 clicked"),
    },
    {
        text: "Channel 24",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 24 clicked"),
    },
    {
        text: "Channel 25",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 25 clicked"),
    },
];

export const users: UserStatus[] = [
    {
        text: "John Doe",
        status: "online",
        avatarUrl: "https://via.placeholder.com/50",
        onClick: () => console.log("John Doe clicked"),
    },
    {
        text: "Jane Smith",
        status: "busy",
        onClick: () => console.log("Jane Smith clicked"),
    },
    {
        text: "Robert Brown",
        status: "away",
        avatarUrl: "https://via.placeholder.com/50",
        onClick: () => console.log("Robert Brown clicked"),
    },
    {
        text: "Alice Lambert",
        status: "offline",
        onClick: () => console.log("Alice Lambert clicked"),
    },
];

export const messages: ChatMessage[] = [
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
];
