// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./avatar";
import { List } from "./list";

import "./list.less";

const meta: Meta<typeof List> = {
    title: "Elements/List",
    component: List,
    argTypes: {
        items: { control: "object" },
        renderItem: { control: false },
    },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Container style for limiting the width to 360px
const Container = (props: any) => (
    <div
        style={{ width: "360px", margin: "0 auto", border: "1px solid #ccc", padding: "10px", boxSizing: "border-box" }}
    >
        {props.children}
    </div>
);

const basicItems = [
    {
        text: "Inbox",
        icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
        onClick: () => console.log("Inbox clicked"),
    },
    {
        text: "Sent Mail",
        icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>,
        onClick: () => console.log("Sent Mail clicked"),
    },
    {
        text: "Drafts",
        icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>,
        onClick: () => console.log("Drafts clicked"),
    },
];

const nestedItems = [
    {
        text: "Inbox",
        icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
        onClick: () => console.log("Inbox clicked"),
        children: [
            {
                text: "Starred",
                icon: <i className="fa-sharp fa-solid fa-star"></i>,
                onClick: () => console.log("Starred clicked"),
            },
            {
                text: "Important",
                icon: <i className="fa-sharp fa-solid fa-star"></i>,
                onClick: () => console.log("Important clicked"),
            },
            {
                text: "Inbox",
                icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
                onClick: () => console.log("Inbox clicked"),
                children: [
                    {
                        text: "Starred",
                        icon: <i className="fa-sharp fa-solid fa-star"></i>,
                        onClick: () => console.log("Starred clicked"),
                    },
                    {
                        text: "Important",
                        icon: <i className="fa-sharp fa-solid fa-star"></i>,
                        onClick: () => console.log("Important clicked"),
                    },
                    {
                        text: "Inbox",
                        icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
                        onClick: () => console.log("Inbox clicked"),
                        children: [
                            {
                                text: "Starred",
                                icon: <i className="fa-sharp fa-solid fa-star"></i>,
                                onClick: () => console.log("Starred clicked"),
                            },
                            {
                                text: "Important",
                                icon: <i className="fa-sharp fa-solid fa-star"></i>,
                                onClick: () => console.log("Important clicked"),
                            },
                            {
                                text: "Inbox",
                                icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
                                onClick: () => console.log("Inbox clicked"),
                                children: [
                                    {
                                        text: "Starred",
                                        icon: <i className="fa-sharp fa-solid fa-star"></i>,
                                        onClick: () => console.log("Starred clicked"),
                                    },
                                    {
                                        text: "Important",
                                        icon: <i className="fa-sharp fa-solid fa-star"></i>,
                                        onClick: () => console.log("Important clicked"),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    {
        text: "Sent Mail",
        icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>,
        onClick: () => console.log("Sent Mail clicked"),
    },
    {
        text: "Drafts",
        icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>,
        onClick: () => console.log("Drafts clicked"),
    },
];

const customRenderItem = (item: any, isOpen: boolean, handleClick: () => void) => (
    <div className="custom-list-item">
        <span className="custom-list-item-icon" onClick={handleClick}>
            {item.icon}
        </span>
        <span className="custom-list-item-text" onClick={handleClick}>
            {item.text}
        </span>
        {item.children && <i className={`fa-sharp fa-solid ${isOpen ? "fa-angle-up" : "fa-angle-down"}`}></i>}
    </div>
);

export const Default: Story = {
    args: {
        items: basicItems,
    },
    render: (args) => (
        <Container>
            <List {...args} />
        </Container>
    ),
};

export const NestedList: Story = {
    args: {
        items: nestedItems,
    },
    render: (args) => (
        <Container>
            <List {...args} />
        </Container>
    ),
};

export const CustomRender: Story = {
    args: {
        items: nestedItems,
        renderItem: customRenderItem,
    },
    render: (args) => (
        <Container>
            <List {...args} />
        </Container>
    ),
};

export const WithClickHandlers: Story = {
    args: {
        items: basicItems,
    },
    render: (args) => (
        <Container>
            <List {...args} />
        </Container>
    ),
};

export const NestedWithClickHandlers: Story = {
    args: {
        items: nestedItems,
    },
    render: (args) => (
        <Container>
            <List {...args} />
        </Container>
    ),
};

const avatarItems = [
    {
        text: "John Doe",
        icon: <Avatar name="John Doe" status="online" className="size-lg" />,
        onClick: () => console.log("John Doe clicked"),
    },
    {
        text: "Jane Smith",
        icon: <Avatar name="Jane Smith" status="busy" className="size-lg" />,
        onClick: () => console.log("Jane Smith clicked"),
    },
    {
        text: "Robert Brown",
        icon: <Avatar name="Robert Brown" status="away" className="size-lg" />,
        onClick: () => console.log("Robert Brown clicked"),
    },
    {
        text: "Alice Lambert",
        icon: <Avatar name="Alice Lambert" status="offline" className="size-lg" />,
        onClick: () => console.log("Alice Lambert clicked"),
    },
];

export const WithAvatars: Story = {
    args: {
        items: avatarItems,
    },
    render: (args) => (
        <Container>
            <List {...args} />
        </Container>
    ),
};
