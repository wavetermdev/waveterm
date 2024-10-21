// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { Popover, PopoverButton, PopoverContent } from "./popover";

const meta: Meta<typeof Popover> = {
    title: "Elements/Popover",
    component: Popover,
    args: {
        className: "custom-popover-class",
    },
    argTypes: {
        className: {
            description: "Custom class for popover styling",
        },
    },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const DefaultPopover: Story = {
    render: (args) => {
        return (
            <div className="boundary" style={{ padding: "20px", height: "00px", border: "2px solid black" }}>
                <Popover {...args}>
                    <PopoverButton className="ghost grey">
                        <i className="fa-sharp fa-solid fa-face-smile"></i>
                    </PopoverButton>
                    <PopoverContent>
                        <div
                            style={{
                                opacity: ".3",
                                display: "flex",
                                alignItems: "center",
                                flexDirection: "column",
                                justifyContent: "center",
                                width: "200px",
                                height: "200px",
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-shelves-empty"></i>
                            <span style={{ fontSize: "11px" }}>Empty</span>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        );
    },
    args: {
        className: "custom-popover-class",
    },
};
