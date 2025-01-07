// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./progressbar";

const meta: Meta<typeof ProgressBar> = {
    title: "Elements/ProgressBar",
    component: ProgressBar,
    args: {
        progress: 0, // Default value
        label: "Progress",
    },
    argTypes: {
        progress: {
            description: "Percentage of progress (0-100)",
            control: { type: "range", min: 0, max: 100 },
        },
        label: {
            description: "Accessible label for the progress bar",
            control: "text",
        },
    },
};

export default meta;

type Story = StoryObj<typeof ProgressBar>;

export const EmptyProgress: Story = {
    render: (args) => (
        <div style={{ padding: "20px", background: "#111", color: "#fff" }}>
            <ProgressBar {...args} />
        </div>
    ),
    args: {
        progress: 0, // No progress
        label: "Empty progress bar",
    },
};

export const FilledProgress: Story = {
    render: (args) => (
        <div style={{ padding: "20px", background: "#111", color: "#fff" }}>
            <ProgressBar {...args} />
        </div>
    ),
    args: {
        progress: 90, // Filled to 90%
        label: "Filled progress bar",
    },
};
