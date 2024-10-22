// Menu.stories.tsx
import { Meta, StoryObj } from "@storybook/react";
import { Menu, MenuItem, MenuItemGroup, MenuItemLeftElement, MenuItemRightElement } from "./menu";

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
            <MenuItemGroup title="Settings">
                <MenuItem>
                    <MenuItemLeftElement>👤</MenuItemLeftElement>
                    <div>Profile</div>
                </MenuItem>
                <MenuItem>
                    <MenuItemLeftElement>🔒</MenuItemLeftElement>
                    <div>Account</div>
                </MenuItem>
            </MenuItemGroup>
            <MenuItemGroup title="More">
                <MenuItemGroup title="Submenu">
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
            <MenuItemGroup title="Categories" defaultExpanded={true}>
                <MenuItemLeftElement>📁</MenuItemLeftElement>
                <div>Categories</div>
                <MenuItemRightElement>{">"}</MenuItemRightElement>

                <MenuItemGroup title="Electronics">
                    <MenuItemLeftElement>📱</MenuItemLeftElement>
                    <div>Electronics</div>
                    <MenuItemGroup title="Mobile Phones">
                        <MenuItemLeftElement>📱</MenuItemLeftElement>
                        <div>Mobile Phones</div>
                        <MenuItemGroup title="Android Phones">
                            <MenuItemLeftElement>🤖</MenuItemLeftElement>
                            <div>Android Phones</div>
                            <MenuItemGroup title="High-End">
                                <MenuItemLeftElement>🔝</MenuItemLeftElement>
                                <div>High-End</div>
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
                            <MenuItemGroup title="Budget">
                                <MenuItem>Redmi Note Series</MenuItem>
                                <MenuItem>Realme</MenuItem>
                            </MenuItemGroup>
                        </MenuItemGroup>
                        <MenuItemGroup title="iPhones">
                            <MenuItem>iPhone 14</MenuItem>
                            <MenuItem>iPhone SE</MenuItem>
                        </MenuItemGroup>
                    </MenuItemGroup>
                    <MenuItemGroup title="Laptops">
                        <MenuItem>Gaming Laptops</MenuItem>
                        <MenuItem>Ultrabooks</MenuItem>
                    </MenuItemGroup>
                </MenuItemGroup>
                <MenuItemGroup title="Appliances">
                    <MenuItemGroup title="Kitchen Appliances">
                        <MenuItem>Microwaves</MenuItem>
                        <MenuItem>Ovens</MenuItem>
                    </MenuItemGroup>
                    <MenuItemGroup title="Large Appliances">
                        <MenuItem>Refrigerators</MenuItem>
                        <MenuItem>Washing Machines</MenuItem>
                    </MenuItemGroup>
                    <MenuItemGroup title="Palette">
                        <MenuItem>
                            <div style={{ width: "400px", height: "500px" }}>test</div>
                        </MenuItem>
                    </MenuItemGroup>
                </MenuItemGroup>
            </MenuItemGroup>
        </Menu>
    ),
};
