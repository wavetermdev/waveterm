// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
import { globalStore } from "@/app/store/jotaiStore";
import type { ZeroAiStatusBarInfo } from "../types";

/**
 * Input text height atom (in pixels or auto)
 */
export const inputHeightAtom = atom<number | "auto">(100);

/**
 * Input width atom (percentage or auto)
 */
export const inputWidthAtom = atom<number | "auto">("auto");

/**
 * Status bar information atom
 */
export const statusBarInfoAtom = atom<ZeroAiStatusBarInfo>({
  provider: null,
  model: null,
  thinking: false,
  workDir: null,
});

/**
 * Is UI minimized (panel collapsed)
 */
export const isMinimizedAtom = atom<boolean>(false);

/**
 * Is input focused
 */
export const isInputFocusedAtom = atom<boolean>(false);

/**
 * UI actions atom - provides functions to manipulate UI state
 */
export const uiActionsAtom = atom(null, (_get, set, action: UIAction) => {
  switch (action.type) {
    case "setInputHeight":
      set(inputHeightAtom, action.height);
      break;

    case "setInputWidth":
      set(inputWidthAtom, action.width);
      break;

    case "setStatusBarInfo":
      set(statusBarInfoAtom, action.info);
      break;

    case "updateStatusBar":
      set(statusBarInfoAtom, (prev) => ({
        ...prev,
        ...action.updates,
      }));
      break;

    case "setMinimized":
      set(isMinimizedAtom, action.minimized);
      break;

    case "setInputFocused":
      set(isInputFocusedAtom, action.focused);
      break;

    case "toggleMinimized":
      set(isMinimizedAtom, (prev) => !prev);
      break;

    case "resetUI":
      set(inputHeightAtom, 100);
      set(inputWidthAtom, "auto");
      set(isMinimizedAtom, false);
      set(isInputFocusedAtom, false);
      set(statusBarInfoAtom, {
        provider: null,
        model: null,
        thinking: false,
        workDir: null,
      });
      break;
  }
});

/**
 * Action types for UI actions
 */
export type UIAction =
  | { type: "setInputHeight"; height: number | "auto" }
  | { type: "setInputWidth"; width: number | "auto" }
  | { type: "setStatusBarInfo"; info: ZeroAiStatusBarInfo }
  | { type: "updateStatusBar"; updates: Partial<ZeroAiStatusBarInfo> }
  | { type: "setMinimized"; minimized: boolean }
  | { type: "setInputFocused"; focused: boolean }
  | { type: "toggleMinimized" }
  | { type: "resetUI" };

/**
 * Helper: Get input height
 */
export function getInputHeight(): number | "auto" {
  return globalStore.get(inputHeightAtom);
}

/**
 * Helper: Set input height
 */
export function setInputHeight(height: number | "auto"): void {
  globalStore.set(inputHeightAtom, height);
}

/**
 * Helper: Get input width
 */
export function getInputWidth(): number | "auto" {
  return globalStore.get(inputWidthAtom);
}

/**
 * Helper: Set input width
 */
export function setInputWidth(width: number | "auto"): void {
  globalStore.set(inputWidthAtom, width);
}

/**
 * Helper: Get status bar info
 */
export function getStatusBarInfo(): ZeroAiStatusBarInfo {
  return globalStore.get(statusBarInfoAtom);
}

/**
 * Helper: Update status bar info (partial update)
 */
export function updateStatusBarInfo(updates: Partial<ZeroAiStatusBarInfo>): void {
  globalStore.set(statusBarInfoAtom, (prev) => ({
    ...prev,
    ...updates,
  }));
}

/**
 * Helper: Set status bar thinking state
 */
export function setThinking(thinking: boolean): void {
  updateStatusBarInfo({ thinking });
}

/**
 * Helper: Is UI minimized
 */
export function getIsMinimized(): boolean {
  return globalStore.get(isMinimizedAtom);
}

/**
 * Helper: Set minimized state
 */
export function setIsMinimized(minimized: boolean): void {
  globalStore.set(isMinimizedAtom, minimized);
}

/**
 * Helper: Toggle minimized state
 */
export function toggleMinimized(): void {
  globalStore.set(isMinimizedAtom, (prev) => !prev);
}

/**
 * Helper: Dispatch UI action
 */
export function dispatchUIAction(action: UIAction): void {
  globalStore.set(uiActionsAtom, action);
}
