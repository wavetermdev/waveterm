// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { MagnifyIcon } from "./magnify";

const meta = {
    title: "Icons/Magnify",
    component: MagnifyIcon,
    args: {
        enabled: true,
    },
} satisfies Meta<typeof MagnifyIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Enabled: Story = {
    args: {
        enabled: true,
    },
};

export const Disabled: Story = {
    args: {
        enabled: false,
    },
};
