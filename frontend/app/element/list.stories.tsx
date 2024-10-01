import { Meta, StoryObj } from "@storybook/react";
import { List } from "./List"; // Import the List component
import "./list.less"; // Assuming you have your LESS styles

const meta: Meta<typeof List> = {
    title: "Components/List",
    component: List,
    argTypes: {
        items: { control: "object" },
        renderItem: { control: false },
        onClick: { control: false },
    },
};

export default meta;
type Story = StoryObj<typeof meta>;

const basicItems = [
    { text: "Inbox", icon: <i className="fa-sharp fa-solid fa-inbox"></i>, link: "/inbox" },
    { text: "Sent Mail", icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>, link: "/sent" },
    { text: "Drafts", icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>, link: "/drafts" },
];

const nestedItems = [
    {
        text: "Inbox",
        icon: <i className="fa-sharp fa-solid fa-inbox"></i>,
        children: [
            { text: "Starred", icon: <i className="fa-sharp fa-solid fa-star"></i> },
            { text: "Important", icon: <i className="fa-sharp fa-solid fa-star"></i> },
        ],
    },
    { text: "Sent Mail", icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>, link: "/sent" },
    { text: "Drafts", icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>, link: "/drafts" },
];

const customRenderItem = (item: any, isOpen: boolean, handleClick: () => void) => (
    <div className="custom-list-item" onClick={handleClick}>
        <span className="custom-list-item-icon">{item.icon}</span>
        <span className="custom-list-item-text">{item.link ? <a href={item.link}>{item.text}</a> : item.text}</span>
        {item.children && <i className={`fa-sharp fa-solid ${isOpen ? "fa-angle-up" : "fa-angle-down"}`}></i>}
    </div>
);

export const Default: Story = {
    args: {
        items: basicItems,
    },
};

export const NestedList: Story = {
    args: {
        items: nestedItems,
    },
};

export const CustomRender: Story = {
    args: {
        items: nestedItems,
        renderItem: customRenderItem,
    },
};

export const WithClickHandlers: Story = {
    args: {
        items: basicItems,
        onClick: (item) => alert(`Item clicked: ${item.text}`),
    },
};

export const NestedWithClickHandlers: Story = {
    args: {
        items: nestedItems,
        onClick: (item) => alert(`Item clicked: ${item.text}`),
    },
};
