// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";
import { SearchInput } from "./searchinput";

const meta: Meta<typeof SearchInput> = {
    title: "Elements/SearchInput",
    component: SearchInput,
    argTypes: {
        className: {
            description: "Custom class for styling the input group",
            control: { type: "text" },
        },
    },
};

export default meta;
type Story = StoryObj<typeof SearchInput>;

export const DefaultSearchInput: Story = {
    render: (args) => {
        const handleSearch = () => {
            console.log("Search triggered");
        };

        return <SearchInput />;
    },
    args: {
        className: "custom-search-input",
    },
};
