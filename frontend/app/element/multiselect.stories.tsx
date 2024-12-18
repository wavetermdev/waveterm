// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { MultiSelect } from "./multiselect";

const meta: Meta<typeof MultiSelect> = {
    title: "Components/MultiSelect",
    component: MultiSelect,
    args: {
        options: [
            { label: "macOS", value: "macos" },
            { label: "Windows", value: "windows" },
            { label: "Linux", value: "linux" },
        ],
    },
    argTypes: {
        options: {
            description: "List of selectable options.",
        },
        selectedValues: {
            description: "Array of selected option values.",
        },
        onChange: {
            description: "Callback triggered when selected options change.",
            action: "changed",
        },
    },
};

export default meta;

type Story = StoryObj<typeof MultiSelect>;

export const WithPreselectedValues: Story = {
    render: (args) => (
        <div style={{ width: "500px", padding: "20px", border: "2px solid #ccc", background: "#111" }}>
            <MultiSelect {...args} />
        </div>
    ),
    args: {
        selectedValues: ["macos", "windows"],
    },
};

export const WithNoSelection: Story = {
    render: (args) => (
        <div style={{ width: "500px", padding: "20px", border: "2px solid #ccc", background: "#111" }}>
            <MultiSelect {...args} />
        </div>
    ),
    args: {
        selectedValues: [],
    },
};
