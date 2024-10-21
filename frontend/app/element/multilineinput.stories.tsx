// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { MultiLineInput } from "./multilineinput";

const meta: Meta<typeof MultiLineInput> = {
    title: "Elements/MultiLineInput",
    component: MultiLineInput,
    argTypes: {
        value: {
            description: "The value of the textarea.",
            control: "text",
        },
        placeholder: {
            description: "The placeholder text for the textarea.",
            control: "text",
            defaultValue: "Type a message...",
        },
        maxRows: {
            description: "Maximum number of rows the textarea can expand to.",
            control: "number",
            defaultValue: 5,
        },
        rows: {
            description: "Initial number of rows for the textarea.",
            control: "number",
            defaultValue: 1,
        },
        maxLength: {
            description: "The maximum number of characters allowed.",
            control: "number",
            defaultValue: 200,
        },
        autoFocus: {
            description: "Autofocus the input when the component mounts.",
            control: "boolean",
            defaultValue: false,
        },
        disabled: {
            description: "Disables the textarea if set to true.",
            control: "boolean",
            defaultValue: false,
        },
    },
};

export default meta;
type Story = StoryObj<typeof MultiLineInput>;

// Default MultiLineInput Story
export const DefaultMultiLineInput: Story = {
    render: (args) => {
        const [message, setMessage] = useState("");

        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setMessage(e.target.value);
        };

        return (
            <div
                style={{
                    width: "100%",
                    height: "600px",
                    padding: "20px",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                }}
            >
                <MultiLineInput {...args} value={message} onChange={handleChange} />
            </div>
        );
    },
    args: {
        placeholder: "Type your message...",
        rows: 1,
        maxRows: 5,
    },
};

// MultiLineInput with long text
export const MultiLineInputWithLongText: Story = {
    render: (args) => {
        const [message, setMessage] = useState("This is a long message that will expand the textarea.");

        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setMessage(e.target.value);
        };

        return (
            <div
                style={{
                    width: "100%",
                    height: "600px",
                    padding: "20px",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                }}
            >
                <MultiLineInput {...args} value={message} onChange={handleChange} />
            </div>
        );
    },
    args: {
        placeholder: "Type a long message...",
        rows: 1,
        maxRows: 10,
    },
};
