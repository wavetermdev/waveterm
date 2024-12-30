// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { Popover } from "./popover";
import { Search, useSearch } from "./search";

const meta: Meta<typeof Search> = {
    title: "Elements/Search",
    component: Search,
    args: {},
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
    render: (args) => {
        const props = useSearch();
        const setIsOpen = useSetAtom(props.isOpen);
        useEffect(() => {
            setIsOpen(true);
        }, []);
        return (
            <div
                className="viewbox"
                ref={props.anchorRef as React.RefObject<HTMLDivElement>}
                style={{
                    border: "2px solid black",
                    width: "100%",
                    height: "200px",
                    background: "var(--main-bg-color)",
                }}
            >
                <Search {...args} {...props} />
            </div>
        );
    },
    args: {},
};

export const AdditionalButtons: Story = {
    render: (args) => {
        const props = useSearch({ regex: true, caseSensitive: true, wholeWord: true });
        const setIsOpen = useSetAtom(props.isOpen);
        useEffect(() => {
            setIsOpen(true);
        }, []);
        return (
            <div
                className="viewbox"
                ref={props.anchorRef as React.RefObject<HTMLDivElement>}
                style={{
                    border: "2px solid black",
                    width: "100%",
                    height: "200px",
                    background: "var(--main-bg-color)",
                }}
            >
                <Search {...args} {...props} />
            </div>
        );
    },
    args: {},
};

export const Results10: Story = {
    render: (args) => {
        const props = useSearch();
        const setIsOpen = useSetAtom(props.isOpen);
        const setNumResults = useSetAtom(props.resultsCount);
        useEffect(() => {
            setIsOpen(true);
            setNumResults(10);
        }, []);
        return (
            <div
                className="viewbox"
                ref={props.anchorRef as React.RefObject<HTMLDivElement>}
                style={{
                    border: "2px solid black",
                    width: "100%",
                    height: "200px",
                    background: "var(--main-bg-color)",
                }}
            >
                <Search {...args} {...props} />
            </div>
        );
    },
    args: {},
};

export const InputAndResults10: Story = {
    render: (args) => {
        const props = useSearch();
        const setIsOpen = useSetAtom(props.isOpen);
        const setNumResults = useSetAtom(props.resultsCount);
        const setSearch = useSetAtom(props.searchValue);
        useEffect(() => {
            setIsOpen(true);
            setNumResults(10);
            setSearch("search term");
        }, []);
        return (
            <div
                className="viewbox"
                ref={props.anchorRef as React.RefObject<HTMLDivElement>}
                style={{
                    border: "2px solid black",
                    width: "100%",
                    height: "200px",
                    background: "var(--main-bg-color)",
                }}
            >
                <Search {...args} {...props} />
            </div>
        );
    },
    args: {},
};

export const LongInputAndResults10: Story = {
    render: (args) => {
        const props = useSearch();
        const setIsOpen = useSetAtom(props.isOpen);
        const setNumResults = useSetAtom(props.resultsCount);
        const setSearch = useSetAtom(props.searchValue);
        useEffect(() => {
            setIsOpen(true);
            setNumResults(10);
            setSearch("search term ".repeat(10).trimEnd());
        }, []);
        return (
            <div
                className="viewbox"
                ref={props.anchorRef as React.RefObject<HTMLDivElement>}
                style={{
                    border: "2px solid black",
                    width: "100%",
                    height: "200px",
                    background: "var(--main-bg-color)",
                }}
            >
                <Search {...args} {...props} />
            </div>
        );
    },
    args: {},
};
