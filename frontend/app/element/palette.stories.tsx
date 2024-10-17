// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { Palette } from "./palette";
import { PaletteButton } from "./palettebutton";
import { PaletteContent } from "./palettecontent";

const meta: Meta<typeof Palette> = {
    title: "Elements/Palette",
    component: Palette,
    args: {
        className: "custom-palette-class",
    },
    argTypes: {
        className: {
            description: "Custom class for palette styling",
        },
    },
};

export default meta;
type Story = StoryObj<typeof Palette>;

export const DefaultPalette: Story = {
    render: (args) => {
        return (
            <div className="boundary" style={{ padding: "20px", height: "500px", border: "2px solid black" }}>
                <Palette {...args}>
                    <PaletteButton className="ghost grey">
                        <i className="fa-sharp fa-solid fa-face-smile"></i>
                    </PaletteButton>
                    <PaletteContent>
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
                    </PaletteContent>
                </Palette>
            </div>
        );
    },
    args: {
        className: "custom-palette-class",
    },
};
