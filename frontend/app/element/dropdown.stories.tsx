import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { Dropdown } from "./dropdown";

const meta = {
    title: "Elements/Dropdown",
    component: Dropdown,
    args: {
        items: [],
        anchorRef: undefined,
        boundaryRef: undefined,
        className: "",
    },
    argTypes: {
        items: {
            description: "Items of dropdown",
        },
        anchorRef: {
            description: "Element to attach the dropdown",
        },
        boundaryRef: {
            description: "Component that defines the boundaries of the dropdown",
        },
        className: {
            description: "Custom className",
        },
    },
} satisfies Meta<typeof Dropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Test: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLDivElement>(null);
        const boundaryRef = useRef<HTMLDivElement>(null);
        const [isDropdownVisible, setIsDropdownVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsDropdownVisible((prev) => !prev);
        };

        return (
            <div
                ref={boundaryRef}
                className="boundary"
                style={{ padding: "20px", height: "300px", border: "2px solid black" }}
            >
                <div style={{ height: "400px" }}>
                    <div
                        ref={anchorRef}
                        style={{
                            backgroundColor: "lightblue",
                            padding: "10px",
                            display: "inline-block",
                            cursor: "pointer",
                        }}
                        onClick={handleAnchorClick}
                    >
                        Anchor Element
                    </div>
                </div>
                {isDropdownVisible && <Dropdown {...args} anchorRef={anchorRef} boundaryRef={boundaryRef} />}
            </div>
        );
    },
    args: {
        items: [
            { label: "Option 1", onClick: () => null },
            {
                label: "Option 2",
                onClick: () => console.log("Clicked Option 2"),
                subItems: [
                    { label: "Option 2 -> 1", onClick: () => null },
                    { label: "Option 2 -> 2", onClick: () => null },
                ],
            },
            {
                label: "Option 3",
                onClick: () => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 3 -> 1", onClick: () => null },
                    { label: "Option 3 -> 2", onClick: () => null },
                    {
                        label: "Option 3 -> 3",
                        onClick: () => console.log("Clicked Option 3"),
                        subItems: [
                            { label: "Option 3 -> 3 -> 1", onClick: () => null },
                            { label: "Option 3 -> 3 -> 2", onClick: () => null },
                            {
                                label: "Option 3 -> 3",
                                onClick: () => console.log("Clicked Option 3"),
                                subItems: [
                                    { label: "Option 3 -> 3 -> 1", onClick: () => null },
                                    { label: "Option 3 -> 3 -> 2", onClick: () => null },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                label: "Option 4",
                onClick: () => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 4 -> 1", onClick: () => null },
                    { label: "Option 4 -> 2", onClick: () => null },
                    { label: "Option 4 -> 4", onClick: () => null },
                    { label: "Option 4 -> 4", onClick: () => null },
                    { label: "Option 4 -> 5", onClick: () => null },
                    { label: "Option 4 -> 6", onClick: () => null },
                    { label: "Option 4 -> 7", onClick: () => null },
                    { label: "Option 4 -> 8", onClick: () => null },
                    { label: "Option 4 -> 9", onClick: () => null },
                    { label: "Option 4 -> 10", onClick: () => null },
                    { label: "Option 4 -> 11", onClick: () => null },
                ],
            },
        ],
    },
};
