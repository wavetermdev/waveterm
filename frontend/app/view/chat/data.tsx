// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { ChatMessage } from "@/app/view/chat/chatmessages";
import { UserStatus } from "@/app/view/chat/userlist";

export const channels: MenuItem[] = [
    {
        label: "Aurora Streams",
        icon: "#",
        onClick: () => console.log("Aurora Streams clicked"),
    },
    {
        label: "Crimson Oasis",
        onClick: () => console.log("Crimson Oasis clicked"),
        subItems: [
            {
                label: "Golden Dunes",
                icon: "#",
                onClick: () => console.log("Golden Dunes clicked"),
            },
            {
                label: "Emerald Springs",
                icon: "#",
                onClick: () => console.log("Emerald Springs clicked"),
            },
            {
                label: "Ruby Cascades",
                icon: "#",
                onClick: () => console.log("Ruby Cascades clicked"),
            },
            {
                label: "Sapphire Falls",
                icon: "#",
                onClick: () => console.log("Sapphire Falls clicked"),
            },
        ],
    },
    {
        label: "Velvet Horizon",
        onClick: () => console.log("Velvet Horizon clicked"),
        subItems: [
            {
                label: "Amber Skies",
                icon: "#",
                onClick: () => console.log("Amber Skies clicked"),
            },
        ],
    },
    {
        label: "Mystic Meadows",
        icon: "#",
        onClick: () => console.log("Mystic Meadows clicked"),
    },
    {
        label: "Celestial Grove",
        icon: "#",
        onClick: () => console.log("Celestial Grove clicked"),
    },
    {
        label: "Twilight Whisper",
        icon: "#",
        onClick: () => console.log("Twilight Whisper clicked"),
    },
    {
        label: "Starlit Haven",
        onClick: () => console.log("Starlit Haven clicked"),
        subItems: [
            {
                label: "Moonlit Trail",
                icon: "#",
                onClick: () => console.log("Moonlit Trail clicked"),
            },
        ],
    },
    {
        label: "Silver Mist",
        icon: "#",
        onClick: () => console.log("Silver Mist clicked"),
    },
    {
        label: "Eclipse Haven",
        onClick: () => console.log("Eclipse Haven clicked"),
        subItems: [
            {
                label: "Obsidian Wave",
                icon: "#",
                onClick: () => console.log("Obsidian Wave clicked"),
            },
            {
                label: "Ivory Shore",
                icon: "#",
                onClick: () => console.log("Ivory Shore clicked"),
            },
            {
                label: "Azure Tide",
                icon: "#",
                onClick: () => console.log("Azure Tide clicked"),
            },
        ],
    },
    {
        label: "Dragon's Peak",
        icon: "#",
        onClick: () => console.log("Dragon's Peak clicked"),
    },
    {
        label: "Seraph's Wing",
        icon: "#",
        onClick: () => console.log("Seraph's Wing clicked"),
    },
    {
        label: "Frozen Abyss",
        icon: "#",
        onClick: () => console.log("Frozen Abyss clicked"),
    },
    {
        label: "Radiant Blossom",
        icon: "#",
        onClick: () => console.log("Radiant Blossom clicked"),
    },
    {
        label: "Whispering Pines",
        icon: "#",
        onClick: () => console.log("Whispering Pines clicked"),
        subItems: [
            {
                label: "Cedar Haven",
                icon: "#",
                onClick: () => console.log("Cedar Haven clicked"),
            },
        ],
    },
    {
        label: "Scarlet Veil",
        icon: "#",
        onClick: () => console.log("Scarlet Veil clicked"),
    },
    {
        label: "Onyx Spire",
        icon: "#",
        onClick: () => console.log("Onyx Spire clicked"),
    },
    {
        label: "Violet Enclave",
        onClick: () => console.log("Violet Enclave clicked"),
        subItems: [
            {
                label: "Indigo Haven",
                icon: "#",
                onClick: () => console.log("Indigo Haven clicked"),
            },
            {
                label: "Amethyst Hollow",
                icon: "#",
                onClick: () => console.log("Amethyst Hollow clicked"),
            },
            {
                label: "Crimson Glow",
                icon: "#",
                onClick: () => console.log("Crimson Glow clicked"),
            },
        ],
    },
];

export const users: UserStatus[] = [
    {
        label: "John Doe",
        status: "online",
        avatarUrl: "https://via.placeholder.com/50",
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
        avatarUrl: "https://via.placeholder.com/50",
        onClick: () => console.log("Robert Brown clicked"),
    },
    {
        label: "Alice Lambert",
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
