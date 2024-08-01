// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export interface LayoutComponentModel {
    disablePointerEvents: boolean;
    onClose?: () => void;
    onMagnifyToggle?: () => void;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
}

export interface BlockProps {
    blockId: string;
    preview: boolean;
    layoutModel: LayoutComponentModel;
}

export interface BlockComponentModel {
    onClick?: () => void;
    onFocusCapture?: React.FocusEventHandler<HTMLDivElement>;
    blockRef?: React.RefObject<HTMLDivElement>;
}

export interface BlockFrameProps {
    blockId: string;
    blockModel?: BlockComponentModel;
    layoutModel?: LayoutComponentModel;
    viewModel?: ViewModel;
    preview: boolean;
    numBlocksInTab?: number;
    children?: React.ReactNode;
}
