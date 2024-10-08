// Story for Palette Component
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Palette } from "./palette";

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
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsMenuVisible((prev) => !prev);
        };

        const handleClickOutside = (event: MouseEvent) => {
            if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
                setIsMenuVisible(false);
            }
        };

        useEffect(() => {
            scopeRef?.current?.addEventListener("mousedown", handleClickOutside);
            return () => {
                scopeRef?.current?.removeEventListener("mousedown", handleClickOutside);
            };
        }, []);

        return (
            <div
                ref={scopeRef}
                className="boundary"
                style={{ padding: "20px", height: "300px", border: "2px solid black" }}
            >
                <Button ref={anchorRef} className="ghost grey" onClick={handleAnchorClick}>
                    <i className="fa-sharp fa-solid fa-face-smile"></i>
                </Button>
                {isMenuVisible && (
                    <Palette anchorRef={anchorRef} scopeRef={scopeRef} {...args}>
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
                    </Palette>
                )}
            </div>
        );
    },
    args: {
        className: "custom-palette-class",
    },
};
