// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Control Components
 *
 * A library of reusable React components for rendering setting controls
 * based on the SettingMetadata type system.
 */

// Main wrapper component
export { SettingControl } from "./setting-control";
export type { SettingControlProps } from "./setting-control";

// Individual control components
export { ToggleControl } from "./toggle-control";
export type { ToggleControlProps } from "./toggle-control";

export { NumberControl } from "./number-control";
export type { NumberControlProps } from "./number-control";

export { SliderControl } from "./slider-control";
export type { SliderControlProps } from "./slider-control";

export { TextControl } from "./text-control";
export type { TextControlProps } from "./text-control";

export { SelectControl } from "./select-control";
export type { SelectControlProps, SelectOption } from "./select-control";

export { ColorControl } from "./color-control";
export type { ColorControlProps } from "./color-control";

export { FontControl } from "./font-control";
export type { FontControlProps } from "./font-control";

export { PathControl } from "./path-control";
export type { PathControlProps } from "./path-control";

export { StringListControl } from "./stringlist-control";
export type { StringListControlProps } from "./stringlist-control";

export { TermThemeControl } from "./termtheme-control";
export type { TermThemeControlProps } from "./termtheme-control";

// Factory for dynamic control rendering
export { ControlFactory, renderSettingControl } from "./control-factory";
export type { ControlFactoryProps } from "./control-factory";
