// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Meta, StoryObj } from "@storybook/react";
import {
    Menu,
    MenuItem,
    MenuItemGroup,
    MenuItemGroupTitle,
    MenuItemLeftElement,
    MenuItemRightElement,
    type MenuItemData,
} from "./menu";

const meta: Meta = {
    title: "Components/Menu",
    component: Menu,
    tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof Menu>;

export const Default: Story = {
    render: () => (
        <Menu>
            <MenuItem>
                <MenuItemLeftElement>🏠</MenuItemLeftElement>
                <div>Dashboard</div>
                <MenuItemRightElement>Ctrl + D</MenuItemRightElement>
            </MenuItem>
            <MenuItemGroup>
                <MenuItemGroupTitle>Settings</MenuItemGroupTitle>
                <MenuItem>
                    <MenuItemLeftElement>👤</MenuItemLeftElement>
                    <div>Profile</div>
                </MenuItem>
                <MenuItem>
                    <MenuItemLeftElement>🔒</MenuItemLeftElement>
                    <div>Account</div>
                </MenuItem>
            </MenuItemGroup>
            <MenuItemGroup>
                <MenuItemGroupTitle>More</MenuItemGroupTitle>
                <MenuItemGroup>
                    <MenuItemGroupTitle>Submenu</MenuItemGroupTitle>
                    <MenuItem>
                        <MenuItemLeftElement>📄</MenuItemLeftElement>
                        <div>Item 1</div>
                    </MenuItem>
                    <MenuItem>
                        <MenuItemLeftElement>📄</MenuItemLeftElement>
                        <div>Item 2</div>
                    </MenuItem>
                </MenuItemGroup>
            </MenuItemGroup>
        </Menu>
    ),
};

export const NestedMenu: Story = {
    render: () => (
        <Menu>
            <MenuItem>
                <MenuItemLeftElement>🏠</MenuItemLeftElement>
                <div>Home</div>
            </MenuItem>
            <MenuItemGroup defaultExpanded={true}>
                <MenuItemGroupTitle>
                    <MenuItemLeftElement>📁</MenuItemLeftElement>
                    <div>Categories</div>
                    <MenuItemRightElement>{">"}</MenuItemRightElement>
                </MenuItemGroupTitle>
                <MenuItemGroup>
                    <MenuItemGroupTitle>
                        <MenuItemLeftElement>📱</MenuItemLeftElement>
                        <div>Electronics</div>
                    </MenuItemGroupTitle>
                    <MenuItemGroup>
                        <MenuItemGroupTitle>
                            <MenuItemLeftElement>📱</MenuItemLeftElement>
                            <div>Mobile Phones</div>
                        </MenuItemGroupTitle>
                        <MenuItemGroup>
                            <MenuItemGroupTitle>
                                <MenuItemLeftElement>🤖</MenuItemLeftElement>
                                <div>Android Phones</div>
                            </MenuItemGroupTitle>
                            <MenuItemGroup>
                                <MenuItemGroupTitle>
                                    <MenuItemLeftElement>🔝</MenuItemLeftElement>
                                    <div>High-End</div>
                                </MenuItemGroupTitle>
                                <MenuItem>
                                    <MenuItemLeftElement>📱</MenuItemLeftElement>
                                    <div>Samsung Galaxy S Series</div>
                                    <MenuItemRightElement>Ctrl + 1</MenuItemRightElement>
                                </MenuItem>
                                <MenuItem>
                                    <MenuItemLeftElement>📱</MenuItemLeftElement>
                                    <div>Google Pixel</div>
                                    <MenuItemRightElement>Ctrl + 2</MenuItemRightElement>
                                </MenuItem>
                            </MenuItemGroup>
                            <MenuItemGroup>
                                <MenuItemGroupTitle>Budget</MenuItemGroupTitle>
                                <MenuItem>Redmi Note Series</MenuItem>
                                <MenuItem>Realme</MenuItem>
                            </MenuItemGroup>
                        </MenuItemGroup>
                        <MenuItemGroup>
                            <MenuItemGroupTitle>iPhones</MenuItemGroupTitle>
                            <MenuItem>iPhone 14</MenuItem>
                            <MenuItem>iPhone SE</MenuItem>
                        </MenuItemGroup>
                    </MenuItemGroup>
                    <MenuItemGroup>
                        <MenuItemGroupTitle>Laptops</MenuItemGroupTitle>
                        <MenuItem>Gaming Laptops</MenuItem>
                        <MenuItem>Ultrabooks</MenuItem>
                    </MenuItemGroup>
                </MenuItemGroup>
                <MenuItemGroup>
                    <MenuItemGroupTitle>Appliances</MenuItemGroupTitle>
                    <MenuItemGroup>
                        <MenuItemGroupTitle>Kitchen Appliances</MenuItemGroupTitle>
                        <MenuItem>Microwaves</MenuItem>
                        <MenuItem>Ovens</MenuItem>
                    </MenuItemGroup>
                    <MenuItemGroup>
                        <MenuItemGroupTitle>Large Appliances</MenuItemGroupTitle>
                        <MenuItem>Refrigerators</MenuItem>
                        <MenuItem>Washing Machines</MenuItem>
                    </MenuItemGroup>
                    <MenuItemGroup>
                        <MenuItemGroupTitle>Palette</MenuItemGroupTitle>
                        <MenuItem>
                            <div style={{ width: "400px", height: "500px" }}>test</div>
                        </MenuItem>
                    </MenuItemGroup>
                </MenuItemGroup>
            </MenuItemGroup>
        </Menu>
    ),
};

const menuData: MenuItemData[] = [
    {
        type: "item",
        leftElement: "🏠",
        content: "Home",
    },
    {
        type: "group",
        title: {
            leftElement: "📁",
            label: "Categories",
            rightElement: ">",
        },
        defaultExpanded: true,
        children: [
            {
                type: "group",
                title: {
                    leftElement: "📱",
                    label: "Electronics",
                },
                children: [
                    {
                        type: "group",
                        title: {
                            leftElement: "📱",
                            label: "Mobile Phones",
                        },
                        children: [
                            {
                                type: "group",
                                title: {
                                    leftElement: "🤖",
                                    label: "Android Phones",
                                },
                                children: [
                                    {
                                        type: "group",
                                        title: {
                                            leftElement: "🔝",
                                            label: "High-End",
                                        },
                                        children: [
                                            {
                                                type: "item",
                                                leftElement: "📱",
                                                content: "Samsung Galaxy S Series",
                                                rightElement: "Ctrl + 1",
                                            },
                                            {
                                                type: "item",
                                                leftElement: "📱",
                                                content: "Google Pixel",
                                                rightElement: "Ctrl + 2",
                                            },
                                        ],
                                    },
                                    {
                                        type: "group",
                                        title: {
                                            label: "Budget",
                                        },
                                        children: [
                                            { type: "item", content: "Redmi Note Series" },
                                            { type: "item", content: "Realme" },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: "group",
                                title: {
                                    label: "iPhones",
                                },
                                children: [
                                    { type: "item", content: "iPhone 14" },
                                    { type: "item", content: "iPhone SE" },
                                ],
                            },
                        ],
                    },
                    {
                        type: "group",
                        title: {
                            label: "Laptops",
                        },
                        children: [
                            { type: "item", content: "Gaming Laptops" },
                            { type: "item", content: "Ultrabooks" },
                        ],
                    },
                ],
            },
            {
                type: "group",
                title: {
                    label: "Appliances",
                },
                children: [
                    {
                        type: "group",
                        title: {
                            label: "Kitchen Appliances",
                        },
                        children: [
                            { type: "item", content: "Microwaves" },
                            { type: "item", content: "Ovens" },
                        ],
                    },
                    {
                        type: "group",
                        title: {
                            label: "Large Appliances",
                        },
                        children: [
                            { type: "item", content: "Refrigerators" },
                            { type: "item", content: "Washing Machines" },
                        ],
                    },
                    {
                        type: "group",
                        title: {
                            label: "Palette",
                        },
                        children: [
                            {
                                type: "item",
                                content: <div style={{ width: "400px", height: "500px" }}>test</div>,
                            },
                        ],
                    },
                ],
            },
        ],
    },
];

const renderMenu = (menuItems: MenuItemData[]) => {
    return menuItems.map((item, index) => {
        if (item.type === "item") {
            return (
                <MenuItem key={index}>
                    {item.leftElement && <MenuItemLeftElement>{item.leftElement}</MenuItemLeftElement>}
                    <div>{item.content}</div>
                    {item.rightElement && <MenuItemRightElement>{item.rightElement}</MenuItemRightElement>}
                    {item.content}
                </MenuItem>
            );
        } else if (item.type === "group") {
            return (
                <MenuItemGroup key={index} defaultExpanded={item.defaultExpanded}>
                    <MenuItemGroupTitle>
                        {item.title.leftElement && <MenuItemLeftElement>{item.title.leftElement}</MenuItemLeftElement>}
                        <div>{item.title.label}</div>
                        {item.title.rightElement && (
                            <MenuItemRightElement>{item.title.rightElement}</MenuItemRightElement>
                        )}
                    </MenuItemGroupTitle>
                    {item.children && renderMenu(item.children)}
                </MenuItemGroup>
            );
        }
    });
};

export const DynamicNestedMenu: Story = {
    render: () => <Menu>{renderMenu(menuData)}</Menu>,
};
