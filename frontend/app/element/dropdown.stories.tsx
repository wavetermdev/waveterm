import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { useEffect, useRef, useState } from "react";
import { Dropdown } from "./dropdown";

const meta = {
    title: "Elements/Dropdown",
    component: Dropdown,
    args: {
        items: [],
        anchorRef: undefined,
        scopeRef: undefined,
        initialPosition: undefined,
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
        initialPosition: {
            description: "Initial position of the dropdown",
        },
        setVisibility: {
            description: "Visibility event handler",
        },
        scopeRef: {
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
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isDropdownVisible, setIsDropdownVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsDropdownVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsDropdownVisible(false);
                },
                subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
            }));
        };

        const modifiedArgs = {
            ...args,
            items: mapItemsWithClick(args.items),
        };

        return (
            <div
                ref={scopeRef}
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
                        scopeRef={scopeRef}
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
                    { label: "Option 2 of 1", onClick: (e) => console.log("Clicked Option 2 of 1") },
                    { label: "Option 2 of 2", onClick: (e) => console.log("Clicked Option 2 of 2") },
                ],
            },
            {
                label: "Option 3",
                onClick: (e) => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 3 of 1", onClick: (e) => console.log("Clicked Option 3 of 1") },
                    { label: "Option 3 of 2", onClick: (e) => console.log("Clicked Option 3 of 2") },
                    {
                        label: "Option 3 of 3",
                        onClick: (e) => console.log("Clicked Option 3 of 3"),
                        subItems: [
                            { label: "Option 3 of 3 of 1", onClick: (e) => console.log("Clicked Option 3 of 3 of 1") },
                            { label: "Option 3 of 3 of 2", onClick: (e) => console.log("Clicked Option 3 of 3 of 2") },
                            { label: "Option 3 of 3 of 3", onClick: (e) => console.log("Clicked Option 3 of 3 of 3") },
                            {
                                label: "Option 3 of 3 of 4",
                                onClick: (e) => console.log("Clicked Option 3 of 3 of 4"),
                                subItems: [
                                    {
                                        label: "Option 3 of 3 of 4 of 1",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 1"),
                                    },
                                    {
                                        label: "Option 3 of 3 of 4 of 2",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 2"),
                                    },
                                    {
                                        label: "Option 3 of 3 of 4 of 3",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 3"),
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
                    { label: "Option 4 of 1", onClick: (e) => console.log("Clicked Option 4 of 1") },
                    { label: "Option 4 of 2", onClick: (e) => console.log("Clicked Option 4 of 2") },
                    { label: "Option 4 of 3", onClick: (e) => console.log("Clicked Option 4 of 3") },
                    { label: "Option 4 of 4", onClick: (e) => console.log("Clicked Option 4 of 4") },
                    { label: "Option 4 of 5", onClick: (e) => console.log("Clicked Option 4 of 5") },
                    { label: "Option 4 of 6", onClick: (e) => console.log("Clicked Option 4 of 6") },
                    { label: "Option 4 of 7", onClick: (e) => console.log("Clicked Option 4 of 7") },
                ],
            },
        ],
    },
};

export const CustomRender: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLDivElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isDropdownVisible, setIsDropdownVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsDropdownVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsDropdownVisible(false);
                },
                subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
            }));
        };

        const renderMenuItem = (item: any, props: any) => (
            <div {...props}>
                <strong>{item.label}</strong>
                {item.subItems && <span style={{ marginLeft: "10px", color: "#888" }}>▶</span>}
            </div>
        );

        const renderMenu = (subMenu: JSX.Element) => <div>{subMenu}</div>;

        const modifiedArgs = {
            ...args,
            items: mapItemsWithClick(args.items),
        };

        return (
            <div
                ref={scopeRef}
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
                        scopeRef={scopeRef}
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
                    { label: "Option 2 of 1", onClick: (e) => console.log("Clicked Option 2 of 1") },
                    { label: "Option 2 of 2", onClick: (e) => console.log("Clicked Option 2 of 2") },
                ],
            },
            {
                label: "Option 3",
                onClick: (e) => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 3 of 1", onClick: (e) => console.log("Clicked Option 3 of 1") },
                    { label: "Option 3 of 2", onClick: (e) => console.log("Clicked Option 3 of 2") },
                    {
                        label: "Option 3 of 3",
                        onClick: (e) => console.log("Clicked Option 3 of 3"),
                        subItems: [
                            { label: "Option 3 of 3 of 1", onClick: (e) => console.log("Clicked Option 3 of 3 of 1") },
                            { label: "Option 3 of 3 of 2", onClick: (e) => console.log("Clicked Option 3 of 3 of 2") },
                            { label: "Option 3 of 3 of 3", onClick: (e) => console.log("Clicked Option 3 of 3 of 3") },
                            {
                                label: "Option 3 of 3 of 4",
                                onClick: (e) => console.log("Clicked Option 3 of 3 of 4"),
                                subItems: [
                                    {
                                        label: "Option 3 of 3 of 4 of 1",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 1"),
                                    },
                                    {
                                        label: "Option 3 of 3 of 4 of 2",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 2"),
                                    },
                                    {
                                        label: "Option 3 of 3 of 4 of 3",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 3"),
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
                    { label: "Option 4 of 1", onClick: (e) => console.log("Clicked Option 4 of 1") },
                    { label: "Option 4 of 2", onClick: (e) => console.log("Clicked Option 4 of 2") },
                    { label: "Option 4 of 3", onClick: (e) => console.log("Clicked Option 4 of 3") },
                    { label: "Option 4 of 4", onClick: (e) => console.log("Clicked Option 4 of 4") },
                    { label: "Option 4 of 5", onClick: (e) => console.log("Clicked Option 4 of 5") },
                    { label: "Option 4 of 6", onClick: (e) => console.log("Clicked Option 4 of 6") },
                    { label: "Option 4 of 7", onClick: (e) => console.log("Clicked Option 4 of 7") },
                ],
            },
        ],
    },
};

export const NoAnchorElement: Story = {
    render: (args) => {
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isDropdownVisible, setIsDropdownVisible] = useState(false);
        const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

        const handleBlockRightClick = (e: MouseEvent) => {
            e.preventDefault(); // Prevent the default context menu
            setDropdownPosition({ top: e.clientY, left: e.clientX });
            setIsDropdownVisible(true);
        };

        useEffect(() => {
            const blockElement = scopeRef.current;
            if (blockElement) {
                blockElement.addEventListener("contextmenu", handleBlockRightClick);
            }

            return () => {
                if (blockElement) {
                    blockElement.removeEventListener("contextmenu", handleBlockRightClick);
                }
            };
        }, []);

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsDropdownVisible(false);
                },
                subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
            }));
        };

        const modifiedArgs = {
            ...args,
            items: mapItemsWithClick(args.items),
        };

        return (
            <div
                ref={scopeRef}
                className="boundary"
                style={{ padding: "20px", height: "300px", border: "2px solid black" }}
            >
                {isDropdownVisible && (
                    <Dropdown
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsDropdownVisible(visible)}
                        initialPosition={dropdownPosition}
                        scopeRef={scopeRef}
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
                    { label: "Option 2 of 1", onClick: (e) => console.log("Clicked Option 2 of 1") },
                    { label: "Option 2 of 2", onClick: (e) => console.log("Clicked Option 2 of 2") },
                ],
            },
            {
                label: "Option 3",
                onClick: (e) => console.log("Clicked Option 3"),
                subItems: [
                    { label: "Option 3 of 1", onClick: (e) => console.log("Clicked Option 3 of 1") },
                    { label: "Option 3 of 2", onClick: (e) => console.log("Clicked Option 3 of 2") },
                    {
                        label: "Option 3 of 3",
                        onClick: (e) => console.log("Clicked Option 3 of 3"),
                        subItems: [
                            { label: "Option 3 of 3 of 1", onClick: (e) => console.log("Clicked Option 3 of 3 of 1") },
                            { label: "Option 3 of 3 of 2", onClick: (e) => console.log("Clicked Option 3 of 3 of 2") },
                            { label: "Option 3 of 3 of 3", onClick: (e) => console.log("Clicked Option 3 of 3 of 3") },
                            {
                                label: "Option 3 of 3 of 4",
                                onClick: (e) => console.log("Clicked Option 3 of 3 of 4"),
                                subItems: [
                                    {
                                        label: "Option 3 of 3 of 4 of 1",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 1"),
                                    },
                                    {
                                        label: "Option 3 of 3 of 4 of 2",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 2"),
                                    },
                                    {
                                        label: "Option 3 of 3 of 4 of 3",
                                        onClick: (e) => console.log("Clicked Option 3 of 3 of 4 of 3"),
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
                    { label: "Option 4 of 1", onClick: (e) => console.log("Clicked Option 4 of 1") },
                    { label: "Option 4 of 2", onClick: (e) => console.log("Clicked Option 4 of 2") },
                    { label: "Option 4 of 3", onClick: (e) => console.log("Clicked Option 4 of 3") },
                    { label: "Option 4 of 4", onClick: (e) => console.log("Clicked Option 4 of 4") },
                    { label: "Option 4 of 5", onClick: (e) => console.log("Clicked Option 4 of 5") },
                    { label: "Option 4 of 6", onClick: (e) => console.log("Clicked Option 4 of 6") },
                    { label: "Option 4 of 7", onClick: (e) => console.log("Clicked Option 4 of 7") },
                ],
            },
        ],
    },
};
