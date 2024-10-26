// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Meta, StoryObj } from "@storybook/react";
import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
    type ExpandableMenuItemData,
} from "./expandablemenu";

const meta: Meta = {
    title: "Elements/ExpandableMenu",
    component: ExpandableMenu,
    tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof ExpandableMenu>;

export const Default: Story = {
    render: () => (
        <ExpandableMenu>
            <ExpandableMenuItem>
                <ExpandableMenuItemLeftElement>🏠</ExpandableMenuItemLeftElement>
                <div>Dashboard</div>
                <ExpandableMenuItemRightElement>Ctrl + D</ExpandableMenuItemRightElement>
            </ExpandableMenuItem>
            <ExpandableMenuItemGroup>
                <ExpandableMenuItemGroupTitle>Settings</ExpandableMenuItemGroupTitle>
                <ExpandableMenuItem>
                    <ExpandableMenuItemLeftElement>👤</ExpandableMenuItemLeftElement>
                    <div>Profile</div>
                </ExpandableMenuItem>
                <ExpandableMenuItem>
                    <ExpandableMenuItemLeftElement>🔒</ExpandableMenuItemLeftElement>
                    <div>Account</div>
                </ExpandableMenuItem>
            </ExpandableMenuItemGroup>
            <ExpandableMenuItemGroup>
                <ExpandableMenuItemGroupTitle>More</ExpandableMenuItemGroupTitle>
                <ExpandableMenuItemGroup>
                    <ExpandableMenuItemGroupTitle>Submenu</ExpandableMenuItemGroupTitle>
                    <ExpandableMenuItem>
                        <ExpandableMenuItemLeftElement>📄</ExpandableMenuItemLeftElement>
                        <div>Item 1</div>
                    </ExpandableMenuItem>
                    <ExpandableMenuItem>
                        <ExpandableMenuItemLeftElement>📄</ExpandableMenuItemLeftElement>
                        <div>Item 2</div>
                    </ExpandableMenuItem>
                </ExpandableMenuItemGroup>
            </ExpandableMenuItemGroup>
        </ExpandableMenu>
    ),
};

export const NestedExpandableMenu: Story = {
    render: () => (
        <ExpandableMenu>
            <ExpandableMenuItem>
                <ExpandableMenuItemLeftElement>🏠</ExpandableMenuItemLeftElement>
                <div>Home</div>
            </ExpandableMenuItem>
            <ExpandableMenuItemGroup isOpen={true}>
                <ExpandableMenuItemGroupTitle>
                    <ExpandableMenuItemLeftElement>📁</ExpandableMenuItemLeftElement>
                    <div>Categories</div>
                    <ExpandableMenuItemRightElement>{">"}</ExpandableMenuItemRightElement>
                </ExpandableMenuItemGroupTitle>
                <ExpandableMenuItemGroup>
                    <ExpandableMenuItemGroupTitle>
                        <ExpandableMenuItemLeftElement>📱</ExpandableMenuItemLeftElement>
                        <div>Electronics</div>
                    </ExpandableMenuItemGroupTitle>
                    <ExpandableMenuItemGroup>
                        <ExpandableMenuItemGroupTitle>
                            <ExpandableMenuItemLeftElement>📱</ExpandableMenuItemLeftElement>
                            <div>Mobile Phones</div>
                        </ExpandableMenuItemGroupTitle>
                        <ExpandableMenuItemGroup>
                            <ExpandableMenuItemGroupTitle>
                                <ExpandableMenuItemLeftElement>🤖</ExpandableMenuItemLeftElement>
                                <div>Android Phones</div>
                            </ExpandableMenuItemGroupTitle>
                            <ExpandableMenuItemGroup>
                                <ExpandableMenuItemGroupTitle>
                                    <ExpandableMenuItemLeftElement>🔝</ExpandableMenuItemLeftElement>
                                    <div>High-End</div>
                                </ExpandableMenuItemGroupTitle>
                                <ExpandableMenuItem>
                                    <ExpandableMenuItemLeftElement>📱</ExpandableMenuItemLeftElement>
                                    <div>Samsung Galaxy S Series</div>
                                    <ExpandableMenuItemRightElement>Ctrl + 1</ExpandableMenuItemRightElement>
                                </ExpandableMenuItem>
                                <ExpandableMenuItem>
                                    <ExpandableMenuItemLeftElement>📱</ExpandableMenuItemLeftElement>
                                    <div>Google Pixel</div>
                                    <ExpandableMenuItemRightElement>Ctrl + 2</ExpandableMenuItemRightElement>
                                </ExpandableMenuItem>
                            </ExpandableMenuItemGroup>
                            <ExpandableMenuItemGroup>
                                <ExpandableMenuItemGroupTitle>Budget</ExpandableMenuItemGroupTitle>
                                <ExpandableMenuItem>Redmi Note Series</ExpandableMenuItem>
                                <ExpandableMenuItem>Realme</ExpandableMenuItem>
                            </ExpandableMenuItemGroup>
                        </ExpandableMenuItemGroup>
                        <ExpandableMenuItemGroup>
                            <ExpandableMenuItemGroupTitle>iPhones</ExpandableMenuItemGroupTitle>
                            <ExpandableMenuItem>iPhone 14</ExpandableMenuItem>
                            <ExpandableMenuItem>iPhone SE</ExpandableMenuItem>
                        </ExpandableMenuItemGroup>
                    </ExpandableMenuItemGroup>
                    <ExpandableMenuItemGroup>
                        <ExpandableMenuItemGroupTitle>Laptops</ExpandableMenuItemGroupTitle>
                        <ExpandableMenuItem>Gaming Laptops</ExpandableMenuItem>
                        <ExpandableMenuItem>Ultrabooks</ExpandableMenuItem>
                    </ExpandableMenuItemGroup>
                </ExpandableMenuItemGroup>
                <ExpandableMenuItemGroup>
                    <ExpandableMenuItemGroupTitle>Appliances</ExpandableMenuItemGroupTitle>
                    <ExpandableMenuItemGroup>
                        <ExpandableMenuItemGroupTitle>Kitchen Appliances</ExpandableMenuItemGroupTitle>
                        <ExpandableMenuItem>Microwaves</ExpandableMenuItem>
                        <ExpandableMenuItem>Ovens</ExpandableMenuItem>
                    </ExpandableMenuItemGroup>
                    <ExpandableMenuItemGroup>
                        <ExpandableMenuItemGroupTitle>Large Appliances</ExpandableMenuItemGroupTitle>
                        <ExpandableMenuItem>Refrigerators</ExpandableMenuItem>
                        <ExpandableMenuItem>Washing Machines</ExpandableMenuItem>
                    </ExpandableMenuItemGroup>
                    <ExpandableMenuItemGroup>
                        <ExpandableMenuItemGroupTitle>Palette</ExpandableMenuItemGroupTitle>
                        <ExpandableMenuItem>
                            <div style={{ width: "400px", height: "500px" }}>test</div>
                        </ExpandableMenuItem>
                    </ExpandableMenuItemGroup>
                </ExpandableMenuItemGroup>
            </ExpandableMenuItemGroup>
        </ExpandableMenu>
    ),
};

const menuData: ExpandableMenuItemData[] = [
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
        isOpen: true,
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

const renderExpandableMenu = (menuItems: ExpandableMenuItemData[]) => {
    return menuItems.map((item) => {
        if (item.type === "item") {
            return (
                <ExpandableMenuItem key={item.id} withHoverEffect={typeof item.content === "string"}>
                    {item.leftElement && (
                        <ExpandableMenuItemLeftElement>{item.leftElement}</ExpandableMenuItemLeftElement>
                    )}
                    <div className="content">{item.content as any}</div>
                    {item.rightElement && (
                        <ExpandableMenuItemRightElement>{item.rightElement}</ExpandableMenuItemRightElement>
                    )}
                </ExpandableMenuItem>
            );
        } else if (item.type === "group") {
            return (
                <ExpandableMenuItemGroup key={item.id} isOpen={item.isOpen}>
                    <ExpandableMenuItemGroupTitle>
                        {item.title.leftElement && (
                            <ExpandableMenuItemLeftElement>{item.title.leftElement}</ExpandableMenuItemLeftElement>
                        )}
                        <div className="label">{item.title.label}</div>
                        {item.title.rightElement && (
                            <ExpandableMenuItemRightElement>{item.title.rightElement}</ExpandableMenuItemRightElement>
                        )}
                    </ExpandableMenuItemGroupTitle>
                    {item.children && renderExpandableMenu(item.children)}
                </ExpandableMenuItemGroup>
            );
        }
    });
};

export const DynamicNestedExpandableMenu: Story = {
    render: () => <ExpandableMenu>{renderExpandableMenu(menuData)}</ExpandableMenu>,
};

export const NoIndentExpandableMenu: Story = {
    render: () => <ExpandableMenu noIndent>{renderExpandableMenu(menuData)}</ExpandableMenu>,
};
