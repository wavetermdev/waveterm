// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Meta, StoryObj } from "@storybook/react";
import { MenuButton } from "./menubutton";

const items: MenuItem[] = [
    { label: "Fruit", onClick: (e) => console.log("Clicked Option 1") },
    {
        label: "Vegetables",
        subItems: [
            { label: "Carrot", onClick: (e) => console.log("Clicked Option 2 -> 1") },
            { label: "Potato", onClick: (e) => console.log("Clicked Option 2 -> 2") },
        ],
    },
    {
        label: "Beverages",
        subItems: [
            { label: "Juice", onClick: (e) => console.log("Clicked Option 3 -> 1") },
            { label: "Tea", onClick: (e) => console.log("Clicked Option 3 -> 2") },
            {
                label: "Coffee",
                subItems: [
                    { label: "Espresso", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 1") },
                    { label: "Latte", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 2") },
                    { label: "Cappuccino", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 3") },
                    {
                        label: "Mocha",
                        subItems: [
                            { label: "Dark Chocolate", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 1") },
                            {
                                label: "White Chocolate",
                                onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 2"),
                            },
                            { label: "Milk Chocolate", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 3") },
                        ],
                    },
                ],
            },
        ],
    },
    {
        label: "Desserts",
        subItems: [
            { label: "Cake", onClick: (e) => console.log("Clicked Option 4 -> 1") },
            { label: "Ice Cream", onClick: (e) => console.log("Clicked Option 4 -> 2") },
            { label: "Cookies", onClick: (e) => console.log("Clicked Option 4 -> 3") },
            { label: "Brownies", onClick: (e) => console.log("Clicked Option 4 -> 4") },
            { label: "Cupcakes", onClick: (e) => console.log("Clicked Option 4 -> 5") },
            { label: "Donuts", onClick: (e) => console.log("Clicked Option 4 -> 6") },
            { label: "Pie", onClick: (e) => console.log("Clicked Option 4 -> 7") },
        ],
    },
];

const meta: Meta<typeof MenuButton> = {
    title: "Elements/MenuButton", // Updated title to reflect the component name
    component: MenuButton,
    argTypes: {
        items: { control: "object" },
        text: { control: "text" },
        title: { control: "text" },
        className: { control: "text" },
    },
};

export default meta;
type Story = StoryObj<typeof meta>;

const basicItems: MenuItem[] = [
    {
        label: "Profile",
        onClick: () => console.log("Profile clicked"),
    },
    {
        label: "Settings",
        onClick: () => console.log("Settings clicked"),
    },
    {
        label: "Logout",
        onClick: () => console.log("Logout clicked"),
    },
];

export const Default: Story = {
    args: {
        items: basicItems,
        text: "Menu",
        title: "Menu Button",
        className: "",
    },
    render: (args) => <MenuButton {...args} />,
};

export const WithMoreItems: Story = {
    args: {
        items: items,
        text: "Extended Menu",
        title: "Extended Menu Button",
        className: "",
    },
    render: (args) => <MenuButton {...args} />,
};
