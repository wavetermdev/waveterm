// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./avatar";
import { CollapsibleMenu } from "./collapsiblemenu";

const meta: Meta<typeof CollapsibleMenu> = {
    title: "Elements/CollapsibleMenu",
    component: CollapsibleMenu,
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
        label: "Inbox",
        icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
        onClick: () => console.log("Inbox clicked"),
    },
    {
        label: "Sent Mail",
        icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>,
        onClick: () => console.log("Sent Mail clicked"),
    },
    {
        label: "Drafts",
        icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>,
        onClick: () => console.log("Drafts clicked"),
    },
];

const nestedItems = [
    {
        label: "Inbox",
        icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
        onClick: () => console.log("Inbox clicked"),
        subItems: [
            {
                label: "Starred",
                icon: <i className="fa-sharp fa-solid fa-star"></i>,
                onClick: () => console.log("Starred clicked"),
            },
            {
                label: "Important",
                icon: <i className="fa-sharp fa-solid fa-star"></i>,
                onClick: () => console.log("Important clicked"),
            },
        ],
    },
    {
        label: "Sent Mail",
        icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>,
        onClick: () => console.log("Sent Mail clicked"),
    },
    {
        label: "Drafts",
        icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>,
        onClick: () => console.log("Drafts clicked"),
    },
];

const customRenderItem = (
    item: MenuItem,
    isOpen: boolean,
    handleClick: (e: React.MouseEvent<any>, item: MenuItem, itemKey: string) => void
) => (
    <div className="custom-list-item">
        <span className="custom-list-item-icon" onClick={(e) => handleClick(e, item, `${item.label}`)}>
            {item.icon}
        </span>
        <span className="custom-list-item-text" onClick={(e) => handleClick(e, item, `${item.label}`)}>
            {item.label}
        </span>
        {item.subItems && <i className={`fa-sharp fa-solid ${isOpen ? "fa-angle-up" : "fa-angle-down"}`}></i>}
    </div>
);

export const Default: Story = {
    args: {
        items: basicItems,
    },
    render: (args) => (
        <Container>
            <CollapsibleMenu {...args} />
        </Container>
    ),
};

export const NestedList: Story = {
    args: {
        items: nestedItems,
    },
    render: (args) => (
        <Container>
            <CollapsibleMenu {...args} />
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
            <CollapsibleMenu {...args} />
        </Container>
    ),
};

export const WithClickHandlers: Story = {
    args: {
        items: basicItems,
    },
    render: (args) => (
        <Container>
            <CollapsibleMenu {...args} />
        </Container>
    ),
};

export const NestedWithClickHandlers: Story = {
    args: {
        items: nestedItems,
    },
    render: (args) => (
        <Container>
            <CollapsibleMenu {...args} />
        </Container>
    ),
};

const avatarItems = [
    {
        label: "John Doe",
        icon: <Avatar name="John Doe" status="online" className="size-lg" />,
        onClick: () => console.log("John Doe clicked"),
    },
    {
        label: "Jane Smith",
        icon: <Avatar name="Jane Smith" status="busy" className="size-lg" />,
        onClick: () => console.log("Jane Smith clicked"),
    },
    {
        label: "Robert Brown",
        icon: <Avatar name="Robert Brown" status="away" className="size-lg" />,
        onClick: () => console.log("Robert Brown clicked"),
    },
    {
        label: "Alice Lambert",
        icon: <Avatar name="Alice Lambert" status="offline" className="size-lg" />,
        onClick: () => console.log("Alice Lambert clicked"),
    },
];
