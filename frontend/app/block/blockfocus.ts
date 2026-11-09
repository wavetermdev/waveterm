// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { focusedBlockId } from "@/util/focusutil";
import { useCallback, useLayoutEffect, useRef } from "react";
import { BlockNodeModel } from "./blocktypes";

export function useBlockFocus(
    nodeModel: Pick<BlockNodeModel, "blockId" | "focusNode">,
    viewModel: Pick<ViewModel, "giveFocus">,
    isFocused: boolean
) {
    const focusElemRef = useRef<HTMLInputElement>(null);
    const pendingFocusRafRef = useRef<number>(null);
    const isFocusedRef = useRef(isFocused);

    const cancelPendingFocus = useCallback(() => {
        if (pendingFocusRafRef.current != null) {
            cancelAnimationFrame(pendingFocusRafRef.current);
            pendingFocusRafRef.current = null;
        }
    }, []);

    const setFocusTarget = useCallback(() => {
        cancelPendingFocus();
        if (viewModel?.giveFocus?.()) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
        pendingFocusRafRef.current = requestAnimationFrame(() => {
            pendingFocusRafRef.current = null;
            // A toolbar control may have gained focus while the view was waiting for a frame.
            if (isFocusedRef.current && document.activeElement === focusElemRef.current) {
                viewModel?.giveFocus?.();
            }
        });
    }, [cancelPendingFocus, viewModel]);

    useLayoutEffect(() => {
        isFocusedRef.current = isFocused;
        if (isFocused && focusedBlockId() != nodeModel.blockId) {
            setFocusTarget();
        }
        return cancelPendingFocus;
    }, [isFocused, nodeModel.blockId, setFocusTarget, cancelPendingFocus]);

    const handleClick = useCallback(() => {
        if (!isFocused) {
            nodeModel.focusNode();
        }
        if (focusedBlockId() != nodeModel.blockId) {
            setFocusTarget();
        }
    }, [isFocused, nodeModel, setFocusTarget]);

    const handleFocusCapture = useCallback(() => {
        if (!isFocused) {
            nodeModel.focusNode();
        }
    }, [isFocused, nodeModel]);

    return { focusElemRef, setFocusTarget, handleClick, handleFocusCapture };
}
