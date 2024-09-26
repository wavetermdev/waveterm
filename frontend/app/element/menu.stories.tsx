import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Menu } from "./menu";

const meta = {
    title: "Elements/Menu",
    component: Menu,
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
            description: "Items of menu",
        },
        anchorRef: {
            description: "Element to attach the menu",
        },
        initialPosition: {
            description: "Initial position of the menu",
        },
        setVisibility: {
            description: "Visibility event handler",
        },
        scopeRef: {
            description: "Component that defines the boundaries of the menu",
        },
        className: {
            description: "Custom className",
        },
    },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultRendererLeftPositioned: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsMenuVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsMenuVisible(false);
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
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <div style={{ position: "absolute", top: 0, left: 0 }}>
                    <Button
                        ref={anchorRef}
                        className="grey border-radius-3 vertical-padding-4 horizontal-padding-6"
                        style={{ borderColor: isMenuVisible ? "var(--accent-color)" : "transparent" }}
                        onClick={handleAnchorClick}
                    >
                        Anchor Element
                    </Button>
                </div>
                {isMenuVisible && (
                    <Menu
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsMenuVisible(visible)}
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

export const DefaultRendererRightPositioned: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsMenuVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsMenuVisible(false);
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
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <div style={{ position: "absolute", top: 0, right: 0 }}>
                    <Button
                        ref={anchorRef}
                        className="grey border-radius-3 vertical-padding-4 horizontal-padding-6"
                        style={{ borderColor: isMenuVisible ? "var(--accent-color)" : "transparent" }}
                        onClick={handleAnchorClick}
                    >
                        Anchor Element
                    </Button>
                </div>
                {isMenuVisible && (
                    <Menu
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsMenuVisible(visible)}
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

export const DefaultRendererBottomRightPositioned: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsMenuVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsMenuVisible(false);
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
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <div style={{ position: "absolute", bottom: 0, left: 0 }}>
                    <Button
                        ref={anchorRef}
                        className="grey border-radius-3 vertical-padding-4 horizontal-padding-6"
                        style={{ borderColor: isMenuVisible ? "var(--accent-color)" : "transparent" }}
                        onClick={handleAnchorClick}
                    >
                        Anchor Element
                    </Button>
                </div>
                {isMenuVisible && (
                    <Menu
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsMenuVisible(visible)}
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

export const DefaultRendererBottomLeftPositioned: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsMenuVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsMenuVisible(false);
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
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <div style={{ position: "absolute", bottom: 0, right: 0 }}>
                    <Button
                        ref={anchorRef}
                        className="grey border-radius-3 vertical-padding-4 horizontal-padding-6"
                        style={{ borderColor: isMenuVisible ? "var(--accent-color)" : "transparent" }}
                        onClick={handleAnchorClick}
                    >
                        Anchor Element
                    </Button>
                </div>
                {isMenuVisible && (
                    <Menu
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsMenuVisible(visible)}
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

export const CustomRenderer: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const handleAnchorClick = () => {
            setIsMenuVisible((prev) => !prev);
        };

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
                    setIsMenuVisible(false);
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
                    <Button
                        ref={anchorRef}
                        className="grey border-radius-3 vertical-padding-4 horizontal-padding-6"
                        style={{ borderColor: isMenuVisible ? "var(--accent-color)" : "transparent" }}
                        onClick={handleAnchorClick}
                    >
                        Anchor Element
                    </Button>
                </div>
                {isMenuVisible && (
                    <Menu
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsMenuVisible(visible)}
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
        const [isMenuVisible, setIsMenuVisible] = useState(false);
        const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

        const handleBlockRightClick = (e: MouseEvent) => {
            e.preventDefault(); // Prevent the default context menu
            setMenuPosition({ top: e.clientY, left: e.clientX });
            setIsMenuVisible(true);
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
                    setIsMenuVisible(false);
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
                {isMenuVisible && (
                    <Menu
                        {...modifiedArgs}
                        setVisibility={(visible) => setIsMenuVisible(visible)}
                        initialPosition={menuPosition}
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
