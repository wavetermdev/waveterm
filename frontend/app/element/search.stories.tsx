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

export const DefaultSearch: Story = {
    render: (args) => {
        const props = useSearch();
        const setIsOpen = useSetAtom(props.isOpenAtom);
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
                    height: "100%",
                    background: "var(--main-bg-color)",
                }}
            >
                <Search {...args} {...props} />
            </div>
        );
    },
    args: {},
};
