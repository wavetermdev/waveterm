// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { Tabs } from "./tabs";

const meta: Meta<typeof Tabs> = {
    title: "Elements/Tabs",
    component: Tabs,
    argTypes: {},
};

export default meta;

type Story = StoryObj<typeof Tabs>;

export const DefaultTabs: Story = {
    render: () => {
        const tabs = [
            { label: "Node 1", onClick: () => console.log("Node 1 Clicked") },
            { label: "Node 2", onClick: () => console.log("Node 2 Clicked") },
            { label: "Node 3", onClick: () => console.log("Node 3 Clicked") },
        ];

        return (
            <div style={{ padding: "20px", backgroundColor: "#000", color: "#fff" }}>
                <Tabs tabs={tabs} />
            </div>
        );
    },
};

export const TabsWithAlerts: Story = {
    render: () => {
        const tabs = [
            { label: "Node 1", onClick: () => alert("Node 1 Clicked") },
            { label: "Node 2", onClick: () => alert("Node 2 Clicked") },
            { label: "Node 3", onClick: () => alert("Node 3 Clicked") },
        ];

        return (
            <div style={{ padding: "20px", backgroundColor: "#000", color: "#fff" }}>
                <Tabs tabs={tabs} />
            </div>
        );
    },
};
