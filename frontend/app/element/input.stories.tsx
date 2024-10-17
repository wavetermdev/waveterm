// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { Input, InputGroup, InputLeftElement, InputRightElement } from "./input"; // Adjust the import path if necessary

// Define the meta object
const meta: Meta<typeof InputGroup> = {
    title: "Elements/Input", // The title under which your story will appear in Storybook
    component: InputGroup, // The component being documented
    args: {
        className: "custom-input-group-class", // Default args
    },
    argTypes: {
        className: {
            description: "Custom class for input group styling",
        },
    },
};

// Export the meta object as the default export
export default meta;

type Story = StoryObj<typeof InputGroup>;

export const DefaultInput: Story = {
    render: (args) => {
        return (
            <div style={{ padding: "20px", height: "400px", border: "2px solid black" }}>
                <Input placeholder="Phone number" />
            </div>
        );
    },
    args: {
        className: "custom-input-group-class",
    },
};

export const InputWithLeftElement: Story = {
    render: (args) => {
        return (
            <div style={{ padding: "20px", height: "400px", border: "2px solid black" }}>
                <InputGroup {...args}>
                    <InputLeftElement>
                        <i className="fa-sharp fa-solid fa-phone-volume"></i>
                    </InputLeftElement>
                    <Input placeholder="Phone number" />
                </InputGroup>
            </div>
        );
    },
    args: {
        className: "custom-input-group-class",
    },
};

export const InputWithLeftAndRightElement: Story = {
    render: (args) => {
        return (
            <div style={{ padding: "20px", height: "400px", border: "2px solid black" }}>
                <InputGroup {...args}>
                    <InputLeftElement>$</InputLeftElement>
                    <Input placeholder="Enter amount" />
                    <InputRightElement>
                        <i className="fa-sharp fa-solid fa-check"></i>
                    </InputRightElement>
                </InputGroup>
            </div>
        );
    },
    args: {
        className: "custom-input-group-class",
    },
};
