// // Copyright 2024, Command Line Inc.
// // SPDX-License-Identifier: Apache-2.0

// import type { Meta, StoryObj } from "@storybook/react";

// import { TileLayout } from "./TileLayout.jsx";

// import { atom } from "jotai";
// import { useState } from "react";
// import { newLayoutNode } from "./layoutNode.js";
// import "./tilelayout.stories.less";
// import {
//     LayoutNode,
//     LayoutTreeActionType,
//     LayoutTreeInsertNodeAction,
//     LayoutTreeState,
//     NodeModel,
//     WritableLayoutTreeStateAtom,
// } from "./types.js";

// const renderTestData = (data: string) => <div>{data}</div>;

// function newLayoutTreeStateAtom(node: LayoutNode): WritableLayoutTreeStateAtom {
//     return atom({ rootNode: node } as LayoutTreeState);
// }

// function renderContent(nodeModel: NodeModel) {
//     return (
//         <div ref={nodeModel.dragHandleRef} className="test-content" style={{ width: "100%", height: "100%" }}>
//             {renderTestData(nodeModel.blockId)}
//         </div>
//     );
// }

// const meta = {
//     title: "TileLayout",
//     args: {
//         layoutTreeStateAtom: newLayoutTreeStateAtom(
//             newLayoutNode(undefined, undefined, undefined, {
//                 blockId: "Hello world!",
//             })
//         ),
//         contents: {
//             renderContent,
//             renderPreview: renderContent,
//             tabId: "",
//         },
//     },
//     component: TileLayout,
//     // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
//     tags: ["autodocs"],
// } satisfies Meta<typeof TileLayout>;

// export default meta;
// type Story = StoryObj<typeof meta>;

// export const Basic: Story = {
//     args: {
//         layoutTreeStateAtom: newLayoutTreeStateAtom(
//             newLayoutNode(undefined, undefined, undefined, { blockId: "Hello world!" })
//         ),
//     },
// };

// export const More: Story = {
//     args: {
//         layoutTreeStateAtom: newLayoutTreeStateAtom<TestData>(
//             newLayoutNode(undefined, undefined, [
//                 newLayoutNode(undefined, undefined, undefined, { name: "Hello world1!" }),
//                 newLayoutNode(undefined, undefined, undefined, { name: "Hello world2!" }),
//                 newLayoutNode(undefined, undefined, [
//                     newLayoutNode(undefined, undefined, undefined, { name: "Hello world3!" }),
//                     newLayoutNode(undefined, undefined, undefined, { name: "Hello world4!" }),
//                 ]),
//             ])
//         ),
//     },
// };

// const evenMoreRootNode = newLayoutNode<TestData>(undefined, undefined, [
//     newLayoutNode(undefined, undefined, undefined, { name: "Hello world1!" }),
//     newLayoutNode(undefined, undefined, [
//         newLayoutNode(undefined, undefined, undefined, { name: "Hello world2!" }),
//         newLayoutNode(undefined, undefined, undefined, { name: "Hello world3!" }),
//     ]),
//     newLayoutNode(undefined, undefined, [
//         newLayoutNode(undefined, undefined, undefined, { name: "Hello world4!" }),
//         newLayoutNode(undefined, undefined, undefined, { name: "Hello world5!" }),
//         newLayoutNode(undefined, undefined, [
//             newLayoutNode(undefined, undefined, undefined, { name: "Hello world6!" }),
//             newLayoutNode(undefined, undefined, undefined, { name: "Hello world7!" }),
//             newLayoutNode(undefined, undefined, undefined, { name: "Hello world8!" }),
//         ]),
//     ]),
// ]);

// export const EvenMore: Story = {
//     args: {
//         layoutTreeStateAtom: newLayoutTreeStateAtom<TestData>(evenMoreRootNode),
//     },
// };

// const addNodeAtom = newLayoutTreeStateAtom(evenMoreRootNode);

// export const AddNode: Story = {
//     render: () => {
//         const [, dispatch] = useLayoutTreeStateReducerAtom(addNodeAtom);
//         const [numAddedNodes, setNumAddedNodes] = useState(0);
//         const dispatchAddNode = () => {
//             const newNode = newLayoutNode(undefined, undefined, undefined, {
//                 name: "New Node" + numAddedNodes,
//             });
//             const insertNodeAction: LayoutTreeInsertNodeAction<TestData> = {
//                 type: LayoutTreeActionType.InsertNode,
//                 node: newNode,
//             };
//             dispatch(insertNodeAction);
//             setNumAddedNodes(numAddedNodes + 1);
//         };
//         return (
//             <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
//                 <div>
//                     <button onClick={dispatchAddNode}>Add node</button>
//                 </div>
//                 <TileLayout
//                     layoutTreeStateAtom={addNodeAtom as WritableLayoutTreeStateAtom<TestData>}
//                     contents={meta.args.contents}
//                 />
//             </div>
//         );
//     },
// };
