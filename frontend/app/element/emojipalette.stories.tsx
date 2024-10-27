// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { EmojiPalette } from "./emojipalette";

const meta: Meta<typeof EmojiPalette> = {
    title: "Elements/EmojiPalette",
    component: EmojiPalette,
    args: {
        className: "custom-emoji-palette-class",
    },
    argTypes: {
        className: {
            description: "Custom class for emoji palette styling",
        },
    },
};

export default meta;
type Story = StoryObj<typeof EmojiPalette>;

export const DefaultEmojiPalette: Story = {
    render: (args) => {
        return (
            <div style={{ padding: "20px", height: "500px", border: "2px solid black" }}>
                <EmojiPalette {...args} />
            </div>
        );
    },
    args: {
        className: "custom-emoji-palette-class",
    },
};
