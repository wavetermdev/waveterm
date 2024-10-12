import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { Button } from "./button";
import { Menu } from "./menu";

const items = [
    { label: "Fruit", onClick: (e) => console.log("Clicked Option 1") },
    {
        label: "Vegetables",
        subItems: [
            { label: "Carrot", onClick: (e) => console.log("Clicked Option 2 -> 1") },
            { label: "Potato", onClick: (e) => console.log("Clicked Option 2 -> 2") },
        ],
    },
    {
        label: "Beverages",
        subItems: [
            { label: "Juice", onClick: (e) => console.log("Clicked Option 3 -> 1") },
            { label: "Tea", onClick: (e) => console.log("Clicked Option 3 -> 2") },
            {
                label: "Coffee",
                subItems: [
                    { label: "Espresso", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 1") },
                    { label: "Latte", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 2") },
                    { label: "Cappuccino", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 3") },
                    {
                        label: "Mocha",
                        subItems: [
                            { label: "Dark Chocolate", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 1") },
                            {
                                label: "White Chocolate",
                                onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 2"),
                            },
                            { label: "Milk Chocolate", onClick: (e) => console.log("Clicked Option 3 -> 3 -> 4 -> 3") },
                        ],
                    },
                ],
            },
        ],
    },
    {
        label: "Desserts",
        subItems: [
            { label: "Cake", onClick: (e) => console.log("Clicked Option 4 -> 1") },
            { label: "Ice Cream", onClick: (e) => console.log("Clicked Option 4 -> 2") },
            { label: "Cookies", onClick: (e) => console.log("Clicked Option 4 -> 3") },
            { label: "Brownies", onClick: (e) => console.log("Clicked Option 4 -> 4") },
            { label: "Cupcakes", onClick: (e) => console.log("Clicked Option 4 -> 5") },
            { label: "Donuts", onClick: (e) => console.log("Clicked Option 4 -> 6") },
            { label: "Pie", onClick: (e) => console.log("Clicked Option 4 -> 7") },
        ],
    },
];

const meta = {
    title: "Elements/Menu",
    component: Menu,
    args: {
        items: [],
        children: null,
    },
    argTypes: {
        items: {
            description: "Items of menu",
        },
        className: {
            description: "Custom className",
        },
        children: {
            description: "The contents of the menu anchor element",
        },
    },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultRendererLeftPositioned: Story = {
    render: (args) => {
        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
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
                className="boundary"
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <Menu {...modifiedArgs}>
                    <div style={{ position: "absolute", top: 0, left: 0 }}>
                        <Button className="grey border-radius-3 vertical-padding-6 horizontal-padding-8">
                            Anchor Element
                            <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                        </Button>
                    </div>
                </Menu>
            </div>
        );
    },
    args: {
        items: items,
    },
};

export const DefaultRendererRightPositioned: Story = {
    render: (args) => {
        const [isMenuVisible, setIsMenuVisible] = useState(false);

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
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
                className="boundary"
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <Menu {...modifiedArgs}>
                    <div style={{ position: "absolute", top: 0, right: 0 }}>
                        <Button className="grey border-radius-3 vertical-padding-6 horizontal-padding-8">
                            Anchor Element
                            <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                        </Button>
                    </div>
                </Menu>
            </div>
        );
    },
    args: {
        items: items,
    },
};

export const DefaultRendererBottomRightPositioned: Story = {
    render: (args) => {
        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
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
                className="boundary"
                style={{ padding: "20px", height: "300px", border: "2px solid black", position: "relative" }}
            >
                <Menu {...modifiedArgs}>
                    <div style={{ position: "absolute", bottom: 0, left: 0 }}>
                        <Button className="grey border-radius-3 vertical-padding-6 horizontal-padding-8">
                            Anchor Element
                            <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                        </Button>
                    </div>
                </Menu>
            </div>
        );
    },
    args: {
        items: items,
    },
};

export const DefaultRendererBottomLeftPositioned: Story = {
    render: (args) => {
        const anchorRef = useRef<HTMLButtonElement>(null);
        const scopeRef = useRef<HTMLDivElement>(null);

        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
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
                <Menu {...modifiedArgs}>
                    <div style={{ position: "absolute", bottom: 0, right: 0 }}>
                        <Button
                            ref={anchorRef}
                            className="grey border-radius-3 vertical-padding-6 horizontal-padding-8"
                        >
                            Anchor Element
                            <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                        </Button>
                    </div>
                </Menu>
            </div>
        );
    },
    args: {
        items: items,
    },
};

export const CustomRenderer: Story = {
    render: (args) => {
        const mapItemsWithClick = (items: any[]) => {
            return items.map((item) => ({
                ...item,
                onClick: () => {
                    if (item.onClick) {
                        item.onClick();
                    }
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
            <div className="boundary" style={{ padding: "20px", height: "300px", border: "2px solid black" }}>
                <Menu {...modifiedArgs} renderMenu={renderMenu} renderMenuItem={renderMenuItem}>
                    <div style={{ height: "400px" }}>
                        <Button className="grey border-radius-3 vertical-padding-6 horizontal-padding-8">
                            Anchor Element
                            <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
                        </Button>
                    </div>
                </Menu>
            </div>
        );
    },
    args: {
        items: items,
    },
};

// export const ContextMenu: Story = {
//     render: (args) => {
//         const scopeRef = useRef<HTMLDivElement>(null);
//         const [isMenuVisible, setIsMenuVisible] = useState(false);
//         const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

//         const handleBlockRightClick = (e: MouseEvent) => {
//             e.preventDefault(); // Prevent the default context menu
//             setMenuPosition({ top: e.clientY, left: e.clientX });
//             setIsMenuVisible(true);
//         };

//         useEffect(() => {
//             const blockElement = scopeRef.current;
//             if (blockElement) {
//                 blockElement.addEventListener("contextmenu", handleBlockRightClick);
//             }

//             return () => {
//                 if (blockElement) {
//                     blockElement.removeEventListener("contextmenu", handleBlockRightClick);
//                 }
//             };
//         }, []);

//         const mapItemsWithClick = (items: any[]) => {
//             return items.map((item) => ({
//                 ...item,
//                 onClick: () => {
//                     if (item.onClick) {
//                         item.onClick();
//                     }
//                 },
//                 subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
//             }));
//         };

//         const modifiedArgs = {
//             ...args,
//             items: mapItemsWithClick(args.items),
//         };

//         return (
//             <div
//                 ref={scopeRef}
//                 className="boundary"
//                 style={{ padding: "20px", height: "300px", border: "2px solid black" }}
//             >
//                 {isMenuVisible && <Menu {...modifiedArgs} />}
//             </div>
//         );
//     },
//     args: {
//         items: items,
//     },
// };
