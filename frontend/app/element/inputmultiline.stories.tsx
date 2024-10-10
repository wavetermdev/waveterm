// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { InputMultiLine } from "./intputmultiline";

const meta: Meta<typeof InputMultiLine> = {
    title: "Elements/InputMultiLine",
    component: InputMultiLine,
    args: {
        label: "Message",
        placeholder: "Type your message here...",
        className: "custom-input-class",
    },
    argTypes: {
        label: {
            description: "Label for the input field",
        },
        placeholder: {
            description: "Placeholder text for the input",
        },
        className: {
            description: "Custom class for input styling",
        },
        decoration: {
            description: "Input decorations for start or end positions",
        },
    },
};

export default meta;
type Story = StoryObj<typeof InputMultiLine>;

export const DefaultInput: Story = {
    render: (args) => {
        return <InputMultiLine {...args} />;
    },
    args: {
        label: "Message",
        placeholder: "Type your message...",
    },
};

export const InputWithErrorState: Story = {
    render: (args) => {
        return <InputMultiLine {...args} required={true} />;
    },
    args: {
        label: "Required Message",
        placeholder: "This field is required...",
    },
};
