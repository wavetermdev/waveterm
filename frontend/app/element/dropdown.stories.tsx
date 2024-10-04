// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";

import { MenuItem } from "./contextmenu";
import { Dropdown } from "./dropdown";

const items: MenuItem[] = [
    { label: "Option 1", onClick: () => console.log("Clicked Option 1") },
    {
        label: "Option 2",
        subItems: [
            { label: "Option 2.1", onClick: () => console.log("Clicked Option 2.1") },
            { label: "Option 2.2", onClick: () => console.log("Clicked Option 2.2") },
        ],
    },
    { label: "Option 3", onClick: () => console.log("Clicked Option 3") },
];

const meta: Meta<typeof Dropdown> = {
    title: "Elements/Dropdown",
    component: Dropdown,
    args: {
        label: "Dropdown Label",
        items: items,
        className: "",
    },
    argTypes: {
        label: {
            description: "Label for the dropdown button",
        },
        items: {
            description: "Menu items for the dropdown",
        },
        className: {
            description: "Custom class for dropdown styling",
        },
    },
};

export default meta;
type Story = StoryObj<typeof Dropdown>;

export const DefaultDropdown: Story = {
    render: (args) => {
        const scopeRef = useRef<HTMLDivElement>(null);

        return (
            <div ref={scopeRef} style={{ padding: "20px", height: "300px", border: "2px solid black" }}>
                <Dropdown {...args} scopeRef={scopeRef} />
            </div>
        );
    },
    args: {
        label: "Options",
        items: items,
    },
};
