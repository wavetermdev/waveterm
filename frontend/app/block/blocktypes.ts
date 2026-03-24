// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { NodeModel } from "@/layout/index";
import { Atom } from "jotai";

export interface BlockNodeModel {
    blockId: string;
    isFocused: Atom<boolean>;
    isMagnified: Atom<boolean>;
    onClose: () => void;
    focusNode: () => void;
    toggleMagnify: () => void;
}

export type FullBlockProps = {
    preview: boolean;
    nodeModel: NodeModel;
    viewModel: ViewModel;
};

export interface BlockProps {
    preview: boolean;
    nodeModel: NodeModel;
}

export type FullSubBlockProps = {
    nodeModel: BlockNodeModel;
    viewModel: ViewModel;
};

export interface SubBlockProps {
    nodeModel: BlockNodeModel;
}

export interface BlockComponentModel2 {
    onClick?: () => void;
    onPointerEnter?: React.PointerEventHandler<HTMLDivElement>;
    onFocusCapture?: React.FocusEventHandler<HTMLDivElement>;
    blockRef?: React.RefObject<HTMLDivElement>;
}

export interface BlockFrameProps {
    blockModel?: BlockComponentModel2;
    nodeModel?: NodeModel;
    viewModel?: ViewModel;
    preview: boolean;
    numBlocksInTab?: number;
    children?: React.ReactNode;
    connBtnRef?: React.RefObject<HTMLDivElement>;
}
