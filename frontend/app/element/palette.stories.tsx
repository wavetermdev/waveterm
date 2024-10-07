// Story for Palette Component
import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { Button } from "./button";
import { Palette } from "./palette";

const meta: Meta<typeof Palette> = {
    title: "Components/Palette",
    component: Palette,
    args: {
        className: "custom-palette-class",
    },
    argTypes: {
        className: {
            description: "Custom class for palette styling",
        },
        anchorRef: {
            description: "Reference to the anchor element for positioning",
        },
    },
};

export default meta;
type Story = StoryObj<typeof Palette>;

export const DefaultPalette: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);

        return (
            <div style={{ padding: "50px" }}>
                <Button ref={anchorRef} className="ghost grey">
                    <i className="fa-sharp fa-solid fa-face-smile"></i>
                </Button>
                <Palette anchorRef={anchorRef} {...args}>
                    <div>This is the Palette content.</div>
                </Palette>
            </div>
        );
    },
    args: {
        className: "custom-palette-class",
    },
};
