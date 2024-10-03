// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "./Layout.css";

const channels = [
    {
        text: "Channel 1",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 1 clicked"),
    },
    {
        text: "Channel 2",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 2 clicked"),
        children: [
            {
                text: "Channel 2.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 2.1 clicked"),
                children: [
                    {
                        text: "Channel 2.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 2.1.1 clicked"),
                    },
                    {
                        text: "Channel 2.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 2.1.2 clicked"),
                    },
                ],
            },
            {
                text: "Channel 2.2",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 2.2 clicked"),
            },
        ],
    },
    {
        text: "Channel 3",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 3 clicked"),
        children: [
            {
                text: "Channel 3.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 3.1 clicked"),
            },
        ],
    },
    {
        text: "Channel 4",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 4 clicked"),
    },
    {
        text: "Channel 5",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 5 clicked"),
        children: [
            {
                text: "Channel 5.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 5.1 clicked"),
                children: [
                    {
                        text: "Channel 5.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 5.1.1 clicked"),
                    },
                    {
                        text: "Channel 5.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 5.1.2 clicked"),
                        children: [
                            {
                                text: "Channel 5.1.2.1",
                                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                                onClick: () => console.log("Channel 5.1.2.1 clicked"),
                            },
                        ],
                    },
                ],
            },
        ],
    },
    {
        text: "Channel 6",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 6 clicked"),
    },
    {
        text: "Channel 7",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 7 clicked"),
        children: [
            {
                text: "Channel 7.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 7.1 clicked"),
            },
        ],
    },
    {
        text: "Channel 8",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 8 clicked"),
    },
    {
        text: "Channel 9",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 9 clicked"),
        children: [
            {
                text: "Channel 9.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 9.1 clicked"),
                children: [
                    {
                        text: "Channel 9.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 9.1.1 clicked"),
                    },
                    {
                        text: "Channel 9.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 9.1.2 clicked"),
                    },
                ],
            },
        ],
    },
    {
        text: "Channel 10",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 10 clicked"),
    },
    {
        text: "Channel 11",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 11 clicked"),
    },
    {
        text: "Channel 12",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 12 clicked"),
    },
    {
        text: "Channel 13",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 13 clicked"),
    },
    {
        text: "Channel 14",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 14 clicked"),
        children: [
            {
                text: "Channel 14.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 14.1 clicked"),
            },
        ],
    },
    {
        text: "Channel 15",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 15 clicked"),
    },
    {
        text: "Channel 16",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 16 clicked"),
    },
    {
        text: "Channel 17",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 17 clicked"),
        children: [
            {
                text: "Channel 17.1",
                icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                onClick: () => console.log("Channel 17.1 clicked"),
                children: [
                    {
                        text: "Channel 17.1.1",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 17.1.1 clicked"),
                    },
                    {
                        text: "Channel 17.1.2",
                        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
                        onClick: () => console.log("Channel 17.1.2 clicked"),
                    },
                ],
            },
        ],
    },
    {
        text: "Channel 18",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 18 clicked"),
    },
    {
        text: "Channel 19",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 19 clicked"),
    },
    {
        text: "Channel 20",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 20 clicked"),
    },
    {
        text: "Channel 21",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 21 clicked"),
    },
    {
        text: "Channel 22",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 22 clicked"),
    },
    {
        text: "Channel 23",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 23 clicked"),
    },
    {
        text: "Channel 24",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 24 clicked"),
    },
    {
        text: "Channel 25",
        icon: <i className="fa-sharp fa-solid fa-wave"></i>,
        onClick: () => console.log("Channel 25 clicked"),
    },
];

const Layout = ({ columns }) => {
    return (
        <div className="layout">
            {columns.map((column, index) => (
                <div
                    key={index}
                    className="layout-column"
                    style={{
                        flexBasis: column.width === "fluid" ? "auto" : `${column.width}px`,
                        flexGrow: column.width === "fluid" ? 1 : 0,
                        flexShrink: column.width === "fluid" ? 1 : 0,
                    }}
                >
                    {column.content}
                </div>
            ))}
        </div>
    );
};

export default Layout;
