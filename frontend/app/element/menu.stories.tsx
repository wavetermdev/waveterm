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
        id: "16830f20-b3b9-42bb-8cc9-db6f409651d8",
    },
    {
        type: "group",
        title: {
            leftElement: "📁",
            label: "Categories",
            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
        },
        defaultExpanded: true,
        id: "4564f119-645e-448c-80b7-2f40f887e670",
        children: [
            {
                type: "group",
                title: {
                    leftElement: "📱",
                    label: "Electronics",
                    rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                },
                id: "596e76eb-d87d-425e-9f6e-1519069ee447",
                children: [
                    {
                        type: "group",
                        title: {
                            leftElement: "📱",
                            label: "Mobile Phones",
                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                        },
                        id: "0dbb9dff-dad3-4a5a-a6b1-53fea2d811c6",
                        children: [
                            {
                                type: "group",
                                title: {
                                    leftElement: "🤖",
                                    label: "Android Phones",
                                    rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                                },
                                id: "7cc2a2df-37d8-426e-9235-c1a0902d5843",
                                children: [
                                    {
                                        type: "group",
                                        title: {
                                            leftElement: "🔝",
                                            label: "High-End",
                                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                                        },
                                        id: "75e709b9-d51b-4054-97e7-6fab33c2f88d",
                                        children: [
                                            {
                                                type: "item",
                                                leftElement: "📱",
                                                content: "Samsung Galaxy S Series",
                                                rightElement: "Ctrl + 1",
                                                id: "5aaa9050-3e58-4fe5-9ff5-638bded6a6e2",
                                            },
                                            {
                                                type: "item",
                                                leftElement: "📱",
                                                content: "Google Pixel",
                                                rightElement: "Ctrl + 2",
                                                id: "56e7f50f-78fc-4145-8294-e78b39de7501",
                                            },
                                        ],
                                    },
                                    {
                                        type: "group",
                                        title: {
                                            label: "Budget",
                                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                                        },
                                        id: "194d25a1-8cdd-41fa-a3a9-6f03d8a6ab37",
                                        children: [
                                            {
                                                type: "item",
                                                content: "Redmi Note Series",
                                                id: "c8b8248a-9c43-4eea-8725-33ae0c783858",
                                            },
                                            {
                                                type: "item",
                                                content: "Realme",
                                                id: "d61c762f-7d75-4f69-828c-24b41d2e0d9b",
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: "group",
                                title: {
                                    label: "iPhones",
                                    rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                                },
                                id: "51b05462-1677-4258-87ac-eb18edc0a76c",
                                children: [
                                    {
                                        type: "item",
                                        content: "iPhone 14",
                                        id: "0f468f54-0118-4e04-a885-ed3f650fc290",
                                    },
                                    {
                                        type: "item",
                                        content: "iPhone SE",
                                        id: "96289d85-c2c5-424b-8157-6d39969ba118",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "group",
                        title: {
                            label: "Laptops",
                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                        },
                        id: "881e7d15-e8a0-4286-9004-ecde9a1a89f4",
                        children: [
                            {
                                type: "item",
                                content: "Gaming Laptops",
                                id: "797859e1-50a2-4dca-93c9-1a630ef16498",
                            },
                            {
                                type: "item",
                                content: "Ultrabooks",
                                id: "b90933d3-aaf1-4aa7-968c-fa3d25201585",
                            },
                        ],
                    },
                ],
            },
            {
                type: "group",
                title: {
                    label: "Appliances",
                    rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                },
                id: "3c9d098e-a4c7-4dae-a350-557672041ebb",
                children: [
                    {
                        type: "group",
                        title: {
                            label: "Kitchen Appliances",
                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                        },
                        id: "541c57e5-6247-4c97-a988-10af0f21c21d",
                        children: [
                            {
                                type: "item",
                                content: "Microwaves",
                                id: "f785da1b-6f60-4411-8444-f928e7ed7e77",
                            },
                            {
                                type: "item",
                                content: "Ovens",
                                id: "a4d3d2a7-bafa-4b4e-b7bd-88177f6515c3",
                            },
                        ],
                    },
                    {
                        type: "group",
                        title: {
                            label: "Large Appliances",
                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                        },
                        id: "c5a94ccc-1d42-45c4-aa22-db65816256a9",
                        children: [
                            {
                                type: "item",
                                content: "Refrigerators",
                                id: "21b78bc0-5012-4f80-b552-00787654581e",
                            },
                            {
                                type: "item",
                                content: "Washing Machines",
                                id: "2eb6eb7d-e624-4eba-88e2-521da1dc8a20",
                            },
                        ],
                    },
                    {
                        type: "group",
                        title: {
                            label: "Palette",
                            rightElement: <i className="fa-sharp fa-solid fa-chevron-right"></i>,
                        },
                        id: "34c52670-9267-47b6-a702-957c6f23a00b",
                        children: [
                            {
                                type: "item",
                                content: <div style={{ width: "400px", height: "500px" }}>test</div>,
                                id: "965c81bb-e08d-4b90-954b-ea69ce33cdce",
                            },
                        ],
                    },
                ],
            },
        ],
    },
];

const renderMenu = (menuItems: MenuItemData[]) => {
    return menuItems.map((item) => {
        if (item.type === "item") {
            console.log("typeof item.content", typeof item.content === "string");
            return (
                <MenuItem key={item.id} withHoverEffect={typeof item.content === "string"}>
                    {item.leftElement && <MenuItemLeftElement>{item.leftElement}</MenuItemLeftElement>}
                    <div>{item.content}</div>
                    {item.rightElement && <MenuItemRightElement>{item.rightElement}</MenuItemRightElement>}
                </MenuItem>
            );
        } else if (item.type === "group") {
            return (
                <MenuItemGroup key={item.id} defaultExpanded={item.defaultExpanded}>
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
