// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { Avatar } from "@/app/element/avatar";

export const channels: ListItem[] = [
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

export type UserListItem = ListItem & {
    status: "online" | "busy" | "away" | "offline";
};

export const users: UserListItem[] = [
    {
        text: "John Doe",
        status: "online",
        icon: <Avatar name="John Doe" status="online" className="size-lg" />,
        onClick: () => console.log("John Doe clicked"),
    },
    {
        text: "Jane Smith",
        status: "busy",
        icon: <Avatar name="Jane Smith" status="busy" className="size-lg" />,
        onClick: () => console.log("Jane Smith clicked"),
    },
    {
        text: "Robert Brown",
        status: "away",
        icon: <Avatar name="Robert Brown" status="away" className="size-lg" />,
        onClick: () => console.log("Robert Brown clicked"),
    },
    {
        text: "Alice Lambert",
        status: "offline",
        icon: <Avatar name="Alice Lambert" status="offline" className="size-lg" />,
        onClick: () => console.log("Alice Lambert clicked"),
    },
];

export type MessageListItem = ListItem & {
    timestamp: string;
};

export const messages: MessageListItem[] = [
    { text: "Message 1 content", timestamp: "2024-09-24 17:02:12" },
    { text: "Message 2 content", timestamp: "2024-07-11 04:17:12" },
    { text: "Message 3 content", timestamp: "2024-07-30 15:32:12" },
    { text: "Message 4 content", timestamp: "2024-07-22 00:05:12" },
    { text: "Message 5 content", timestamp: "2024-06-29 17:42:12" },
    { text: "Message 6 content", timestamp: "2024-08-05 00:48:12" },
    { text: "Message 7 content", timestamp: "2024-08-11 01:19:12" },
    { text: "Message 8 content", timestamp: "2024-07-08 09:43:12" },
    { text: "Message 9 content", timestamp: "2024-09-08 21:47:12" },
    { text: "Message 10 content", timestamp: "2024-08-26 13:30:12" },
    { text: "Message 11 content", timestamp: "2024-07-02 14:35:12" },
    { text: "Message 12 content", timestamp: "2024-08-04 01:43:12" },
    { text: "Message 13 content", timestamp: "2024-06-26 17:40:12" },
    { text: "Message 14 content", timestamp: "2024-07-15 12:19:12" },
    { text: "Message 15 content", timestamp: "2024-09-18 21:13:12" },
    { text: "Message 16 content", timestamp: "2024-07-20 07:41:12" },
    { text: "Message 17 content", timestamp: "2024-09-21 05:35:12" },
    { text: "Message 18 content", timestamp: "2024-09-09 01:02:12" },
    { text: "Message 19 content", timestamp: "2024-08-18 12:29:12" },
    { text: "Message 20 content", timestamp: "2024-09-22 10:10:12" },
    { text: "Message 21 content", timestamp: "2024-09-05 08:35:12" },
    { text: "Message 22 content", timestamp: "2024-07-12 01:07:12" },
    { text: "Message 23 content", timestamp: "2024-06-27 11:35:12" },
    { text: "Message 24 content", timestamp: "2024-08-19 03:15:12" },
    { text: "Message 25 content", timestamp: "2024-09-14 20:29:12" },
    { text: "Message 26 content", timestamp: "2024-06-29 07:10:12" },
    { text: "Message 27 content", timestamp: "2024-07-28 14:05:12" },
    { text: "Message 28 content", timestamp: "2024-08-22 02:15:12" },
    { text: "Message 29 content", timestamp: "2024-09-07 15:47:12" },
    { text: "Message 30 content", timestamp: "2024-09-01 13:21:12" },
    { text: "Message 31 content", timestamp: "2024-07-03 16:42:12" },
    { text: "Message 32 content", timestamp: "2024-09-04 04:11:12" },
    { text: "Message 33 content", timestamp: "2024-08-07 03:14:12" },
];
