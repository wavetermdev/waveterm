import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
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
        setVisibility: fn(),
    },
    argTypes: {
        items: {
            description: "Items of dropdown",
        },
        anchorRef: {
            description: "Element to attach the dropdown",
        },
        setVisibility: {
            description: "Visibility event handler",
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

export const DefaultRender: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLDivElement>(null);
        const boundaryRef = useRef<HTMLDivElement>(null);
        const [isDropdownVisible, setIsDropdownVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsDropdownVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    // Call the original onClick if it exists
                    if (item.onClick) {
                        item.onClick();
                    }
                    // Close the dropdown after an item is clicked
                    setIsDropdownVisible(false);
                },
                // Recursively update subItems' onClick handlers
                subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
            }));
        };

        // Modify args to include updated items with the new onClick behavior
        const modifiedArgs = {
            ...args,
            items: mapItemsWithClick(args.items),
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
                {isDropdownVisible && (
                    <Dropdown
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsDropdownVisible(visible)}
                        anchorRef={anchorRef}
                        boundaryRef={boundaryRef}
                    />
                )}
            </div>
        );
    },
    args: {
        items: [
            { label: "Option 1", onClick: (e) => console.log("Clicked Option 1") },
            {
                label: "Option 2",
                onClick: (e) => console.log("Clicked Option 2"),
                subItems: [
                    { label: "Option 2 -> 1", onClick: (e) => console.log("Clicked Option 2 -> 1") },
                    { label: "Option 2 -> 2", onClick: (e) => console.log("Clicked Option 2 -> 2") },
                ],
            },
            {
                label: "Option 3",
                onClick: (e) => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 3 -> 1", onClick: (e) => console.log("Clicked Option 3 -> 1") },
                    { label: "Option 3 -> 2", onClick: (e) => console.log("Clicked Option 3 -> 2") },
                    {
                        label: "Option 3 -> 3",
                        onClick: (e) => console.log("Clicked Option 3 -> 3"),
                        subItems: [
                            { label: "Option 3 -> 3 -> 1", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 1") },
                            { label: "Option 3 -> 3 -> 2", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 2") },
                            { label: "Option 3 -> 3 -> 3", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 3") },
                            {
                                label: "Option 3 -> 3 -> 4",
                                onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4"),
                                subItems: [
                                    {
                                        label: "Option 3 -> 3 -> 4 -> 1",
                                        onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 1"),
                                    },
                                    {
                                        label: "Option 3 -> 3 -> 4 -> 2",
                                        onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 2"),
                                    },
                                    {
                                        label: "Option 3 -> 3 -> 4 -> 3",
                                        onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 3"),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                label: "Option 4",
                onClick: (e) => console.log("Clicked Option 4"),
                subItems: [
                    { label: "Option 4 -> 1", onClick: (e) => console.log("Clicked Option 4 -> 1") },
                    { label: "Option 4 -> 2", onClick: (e) => console.log("Clicked Option 4 -> 2") },
                    { label: "Option 4 -> 3", onClick: (e) => console.log("Clicked Option 4 -> 3") },
                    { label: "Option 4 -> 4", onClick: (e) => console.log("Clicked Option 4 -> 4") },
                    { label: "Option 4 -> 5", onClick: (e) => console.log("Clicked Option 4 -> 5") },
                    { label: "Option 4 -> 6", onClick: (e) => console.log("Clicked Option 4 -> 6") },
                    { label: "Option 4 -> 7", onClick: (e) => console.log("Clicked Option 4 -> 7") },
                ],
            },
        ],
    },
};

export const CustomRender: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLDivElement>(null);
        const boundaryRef = useRef<HTMLDivElement>(null);
        const [isDropdownVisible, setIsDropdownVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsDropdownVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    // Call the original onClick if it exists
                    if (item.onClick) {
                        item.onClick();
                    }
                    // Close the dropdown after an item is clicked
                    setIsDropdownVisible(false);
                },
                // Recursively update subItems' onClick handlers
                subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
            }));
        };

        // Custom render function for menu items
        const renderMenuItem = (item: any, props: any) => (
            <div {...props}>
                <strong>{item.label}</strong>
                {item.subItems && <span style={{ marginLeft: "10px", color: "#888" }}>▶</span>}
            </div>
        );

        // Custom render function for the entire menu
        const renderMenu = (subMenu: JSX.Element) => <div>{subMenu}</div>;

        // Modify args to include updated items with the new onClick behavior
        const modifiedArgs = {
            ...args,
            items: mapItemsWithClick(args.items),
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
                {isDropdownVisible && (
                    <Dropdown
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsDropdownVisible(visible)}
                        anchorRef={anchorRef}
                        boundaryRef={boundaryRef}
                        renderMenu={renderMenu}
                        renderMenuItem={renderMenuItem}
                    />
                )}
            </div>
        );
    },
    args: {
        items: [
            { label: "Option 1", onClick: (e) => console.log("Clicked Option 1") },
            {
                label: "Option 2",
                onClick: (e) => console.log("Clicked Option 2"),
                subItems: [
                    { label: "Option 2 -> 1", onClick: (e) => console.log("Clicked Option 2 -> 1") },
                    { label: "Option 2 -> 2", onClick: (e) => console.log("Clicked Option 2 -> 2") },
                ],
            },
            {
                label: "Option 3",
                onClick: (e) => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 3 -> 1", onClick: (e) => console.log("Clicked Option 3 -> 1") },
                    { label: "Option 3 -> 2", onClick: (e) => console.log("Clicked Option 3 -> 2") },
                    {
                        label: "Option 3 -> 3",
                        onClick: (e) => console.log("Clicked Option 3 -> 3"),
                        subItems: [
                            { label: "Option 3 -> 3 -> 1", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 1") },
                            { label: "Option 3 -> 3 -> 2", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 2") },
                            { label: "Option 3 -> 3 -> 3", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 3") },
                            {
                                label: "Option 3 -> 3 -> 4",
                                onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4"),
                                subItems: [
                                    {
                                        label: "Option 3 -> 3 -> 4 -> 1",
                                        onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 1"),
                                    },
                                    {
                                        label: "Option 3 -> 3 -> 4 -> 2",
                                        onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 2"),
                                    },
                                    {
                                        label: "Option 3 -> 3 -> 4 -> 3",
                                        onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 3"),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                label: "Option 4",
                onClick: (e) => console.log("Clicked Option 4"),
                subItems: [
                    { label: "Option 4 -> 1", onClick: (e) => console.log("Clicked Option 4 -> 1") },
                    { label: "Option 4 -> 2", onClick: (e) => console.log("Clicked Option 4 -> 2") },
                    { label: "Option 4 -> 3", onClick: (e) => console.log("Clicked Option 4 -> 3") },
                    { label: "Option 4 -> 4", onClick: (e) => console.log("Clicked Option 4 -> 4") },
                    { label: "Option 4 -> 5", onClick: (e) => console.log("Clicked Option 4 -> 5") },
                    { label: "Option 4 -> 6", onClick: (e) => console.log("Clicked Option 4 -> 6") },
                    { label: "Option 4 -> 7", onClick: (e) => console.log("Clicked Option 4 -> 7") },
                ],
            },
        ],
    },
};
