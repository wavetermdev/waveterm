// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { Button } from "./button";

const meta = {
    title: "Elements/Button",
    component: Button,
    args: {
        children: "Click Me",
        disabled: false,
        className: "",
        onClick: fn(),
    },
    argTypes: {
        onClick: {
            action: "clicked",
            description: "Click event handler",
        },
        children: {
            description: "Content inside the button",
        },
        disabled: {
            description: "Disables the button if true",
        },
        className: {
            description: "Additional class names to style the button",
        },
    },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
    args: {
        disabled: true,
        children: "Disabled Button",
    },
};

export const GreySolid: Story = {
    args: {
        className: "solid grey",
        children: "Grey Solid Button",
    },
};

export const RedSolid: Story = {
    args: {
        className: "solid red",
        children: "Red Solid Button",
    },
};

export const YellowSolid: Story = {
    args: {
        className: "solid yellow",
        children: "Yellow Solid Button",
    },
};

export const GreenOutlined: Story = {
    args: {
        className: "outlined green",
        children: "Green Outline Button",
    },
};

export const GreyOutlined: Story = {
    args: {
        className: "outlined grey",
        children: "Grey Outline Button",
    },
};

export const RedOutlined: Story = {
    args: {
        className: "outlined red",
        children: "Red Outline Button",
    },
};

export const YellowOutlined: Story = {
    args: {
        className: "outlined yellow",
        children: "Yellow Outline Button",
    },
};

export const GreenGhostText: Story = {
    args: {
        className: "ghost green",
        children: "Yellow Ghost Text Button",
    },
};

export const GreyGhostText: Story = {
    args: {
        className: "ghost grey",
        children: "Grey Ghost Text Button",
    },
};

export const RedGhost: Story = {
    args: {
        className: "ghost red",
        children: "Red Ghost Text Button",
    },
};

export const YellowGhostText: Story = {
    args: {
        className: "ghost yellow",
        children: "Yellow Ghost Text Button",
    },
};
