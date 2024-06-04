// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react";

import { TileLayout } from "./TileLayout.jsx";

import { useState } from "react";
import { newLayoutTreeStateAtom, useLayoutTreeStateReducerAtom } from "./layoutAtom.js";
import { newLayoutNode } from "./layoutNode.js";
import { LayoutTreeActionType, LayoutTreeInsertNodeAction } from "./model.js";
import "./tilelayout.stories.less";
import { FlexDirection } from "./utils.js";

interface TestData {
    name: string;
}

const renderTestData = (data: TestData) => <div>{data.name}</div>;

const meta = {
    title: "TileLayout",
    args: {
        layoutTreeStateAtom: newLayoutTreeStateAtom<TestData>(
            newLayoutNode(FlexDirection.Row, undefined, undefined, {
                name: "Hello world!",
            })
        ),
        renderContent: renderTestData,
    },
    component: TileLayout<TestData>,
    // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
    tags: ["autodocs"],
} satisfies Meta<typeof TileLayout<TestData>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
    args: {
        layoutTreeStateAtom: newLayoutTreeStateAtom<TestData>(
            newLayoutNode(FlexDirection.Row, undefined, undefined, { name: "Hello world!" })
        ),
    },
};

export const More: Story = {
    args: {
        layoutTreeStateAtom: newLayoutTreeStateAtom<TestData>(
            newLayoutNode(FlexDirection.Row, undefined, [
                newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world1!" }),
                newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world2!" }),
                newLayoutNode(FlexDirection.Column, undefined, [
                    newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world3!" }),
                    newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world4!" }),
                ]),
            ])
        ),
    },
};

const evenMoreRootNode = newLayoutNode<TestData>(FlexDirection.Row, undefined, [
    newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world1!" }),
    newLayoutNode(FlexDirection.Column, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world2!" }),
        newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world3!" }),
    ]),
    newLayoutNode(FlexDirection.Column, undefined, [
        newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world4!" }),
        newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world5!" }),
        newLayoutNode(FlexDirection.Column, undefined, [
            newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world6!" }),
            newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world7!" }),
            newLayoutNode(FlexDirection.Column, undefined, undefined, { name: "Hello world8!" }),
        ]),
    ]),
]);

export const EvenMore: Story = {
    args: {
        layoutTreeStateAtom: newLayoutTreeStateAtom<TestData>(evenMoreRootNode),
    },
};

const addNodeAtom = newLayoutTreeStateAtom(evenMoreRootNode);

export const AddNode: Story = {
    render: () => {
        const [, dispatch] = useLayoutTreeStateReducerAtom(addNodeAtom);
        const [numAddedNodes, setNumAddedNodes] = useState(0);
        const dispatchAddNode = () => {
            const newNode = newLayoutNode(FlexDirection.Column, undefined, undefined, {
                name: "New Node" + numAddedNodes,
            });
            const insertNodeAction: LayoutTreeInsertNodeAction<TestData> = {
                type: LayoutTreeActionType.InsertNode,
                node: newNode,
            };
            dispatch(insertNodeAction);
            setNumAddedNodes(numAddedNodes + 1);
        };
        return (
            <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
                <div>
                    <button onClick={dispatchAddNode}>Add node</button>
                </div>
                <TileLayout layoutTreeStateAtom={addNodeAtom} renderContent={renderTestData} />
            </div>
        );
    },
};
