// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/model.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Suggestion = {
    name: string;
    allNames: string[];
    description?: string;
    icon: string;
    priority: number;
    insertValue?: string;
};

export type SuggestionBlob = {
    suggestions: Suggestion[];
    argumentDescription?: string;
    charactersToDrop?: number;
};
