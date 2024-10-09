// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { ChatMessage } from "@/app/element/chatmessages";
import { MenuItem } from "@/app/element/menu";
import { UserStatus } from "@/app/element/userlist";

export const channels: MenuItem[] = [
    {
        text: "Aurora Streams",
        icon: "#",
        onClick: () => console.log("Aurora Streams clicked"),
    },
    {
        text: "Crimson Oasis",
        onClick: () => console.log("Crimson Oasis clicked"),
        children: [
            {
                text: "Golden Dunes",
                icon: "#",
                onClick: () => console.log("Golden Dunes clicked"),
            },
            {
                text: "Emerald Springs",
                icon: "#",
                onClick: () => console.log("Emerald Springs clicked"),
            },
            {
                text: "Ruby Cascades",
                icon: "#",
                onClick: () => console.log("Ruby Cascades clicked"),
            },
            {
                text: "Sapphire Falls",
                icon: "#",
                onClick: () => console.log("Sapphire Falls clicked"),
            },
        ],
    },
    {
        text: "Velvet Horizon",
        onClick: () => console.log("Velvet Horizon clicked"),
        children: [
            {
                text: "Amber Skies",
                icon: "#",
                onClick: () => console.log("Amber Skies clicked"),
            },
        ],
    },
    {
        text: "Mystic Meadows",
        icon: "#",
        onClick: () => console.log("Mystic Meadows clicked"),
    },
    {
        text: "Celestial Grove",
        icon: "#",
        onClick: () => console.log("Celestial Grove clicked"),
    },
    {
        text: "Twilight Whisper",
        icon: "#",
        onClick: () => console.log("Twilight Whisper clicked"),
    },
    {
        text: "Starlit Haven",
        onClick: () => console.log("Starlit Haven clicked"),
        children: [
            {
                text: "Moonlit Trail",
                icon: "#",
                onClick: () => console.log("Moonlit Trail clicked"),
            },
        ],
    },
    {
        text: "Silver Mist",
        icon: "#",
        onClick: () => console.log("Silver Mist clicked"),
    },
    {
        text: "Eclipse Haven",
        onClick: () => console.log("Eclipse Haven clicked"),
        children: [
            {
                text: "Obsidian Wave",
                icon: "#",
                onClick: () => console.log("Obsidian Wave clicked"),
            },
            {
                text: "Ivory Shore",
                icon: "#",
                onClick: () => console.log("Ivory Shore clicked"),
            },
            {
                text: "Azure Tide",
                icon: "#",
                onClick: () => console.log("Azure Tide clicked"),
            },
        ],
    },
    {
        text: "Dragon's Peak",
        icon: "#",
        onClick: () => console.log("Dragon's Peak clicked"),
    },
    {
        text: "Seraph's Wing",
        icon: "#",
        onClick: () => console.log("Seraph's Wing clicked"),
    },
    {
        text: "Frozen Abyss",
        icon: "#",
        onClick: () => console.log("Frozen Abyss clicked"),
    },
    {
        text: "Radiant Blossom",
        icon: "#",
        onClick: () => console.log("Radiant Blossom clicked"),
    },
    {
        text: "Whispering Pines",
        icon: "#",
        onClick: () => console.log("Whispering Pines clicked"),
        children: [
            {
                text: "Cedar Haven",
                icon: "#",
                onClick: () => console.log("Cedar Haven clicked"),
            },
        ],
    },
    {
        text: "Scarlet Veil",
        icon: "#",
        onClick: () => console.log("Scarlet Veil clicked"),
    },
    {
        text: "Onyx Spire",
        icon: "#",
        onClick: () => console.log("Onyx Spire clicked"),
    },
    {
        text: "Violet Enclave",
        onClick: () => console.log("Violet Enclave clicked"),
        children: [
            {
                text: "Indigo Haven",
                icon: "#",
                onClick: () => console.log("Indigo Haven clicked"),
            },
            {
                text: "Amethyst Hollow",
                icon: "#",
                onClick: () => console.log("Amethyst Hollow clicked"),
            },
            {
                text: "Crimson Glow",
                icon: "#",
                onClick: () => console.log("Crimson Glow clicked"),
            },
        ],
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
