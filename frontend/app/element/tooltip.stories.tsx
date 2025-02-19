// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

import "./tooltip.scss";

const meta: Meta<typeof Tooltip> = {
    title: "Elements/Tooltip",
    component: Tooltip,
    argTypes: {
        placement: {
            description: "Placement of the tooltip relative to the trigger",
            control: {
                type: "select",
                options: ["top", "left", "bottom", "right"],
            },
        },
        className: {
            description: "Custom class for styling the tooltip content",
            control: { type: "text" },
        },
        initialOpen: {
            description: "Initial open state of the tooltip (uncontrolled mode)",
            control: { type: "boolean" },
        },
        open: {
            description: "Controlled open state of the tooltip",
            control: { type: "boolean" },
        },
        showArrow: {
            description: "Whether to show an arrow for the tooltip",
            control: { type: "boolean" },
        },
    },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Uncontrolled: Story = {
    render: (args) => (
        <div
            style={{
                width: "100%",
                height: "600px",
                padding: "20px",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
            }}
        >
            <div className="App">
                <Tooltip {...args}>
                    <TooltipTrigger>Top</TooltipTrigger>
                    <TooltipContent className="tooltip">Top Tooltip</TooltipContent>
                </Tooltip>
                <Tooltip {...args} placement="left">
                    <TooltipTrigger>Left</TooltipTrigger>
                    <TooltipContent className="tooltip">Left Tooltip</TooltipContent>
                </Tooltip>
                <Tooltip {...args} placement="bottom">
                    <TooltipTrigger>Bottom</TooltipTrigger>
                    <TooltipContent className="tooltip">Bottom Tooltip</TooltipContent>
                </Tooltip>
                <Tooltip {...args} placement="right">
                    <TooltipTrigger>Right</TooltipTrigger>
                    <TooltipContent className="tooltip">Right Tooltip</TooltipContent>
                </Tooltip>
            </div>
        </div>
    ),
    args: {
        initialOpen: false,
        placement: "top",
        className: "custom-tooltip",
        showArrow: true,
    },
};

// Controlled Tooltip Example
export const Controlled: Story = {
    render: (args) => {
        const [open, setOpen] = useState(false);

        return (
            <div
                style={{
                    width: "100%",
                    height: "600px",
                    padding: "20px",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                }}
            >
                <div className="App">
                    <Tooltip {...args} open={open} onOpenChange={setOpen}>
                        <TooltipTrigger onClick={() => setOpen((v) => !v)}>My Trigger</TooltipTrigger>
                        <TooltipContent className="tooltip">My tooltip</TooltipContent>
                    </Tooltip>
                </div>
            </div>
        );
    },
    args: {
        placement: "top",
        className: "custom-tooltip",
        showArrow: true,
    },
};
