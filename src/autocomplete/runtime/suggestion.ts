// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/suggestion.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

enum SuggestionIcons {
    File = "📄",
    Folder = "📁",
    Subcommand = "📦",
    Option = "🔗",
    Argument = "💲",
    Mixin = "🏝️",
    Shortcut = "🔥",
    Special = "⭐",
    Default = "📀",
}

export const getIcon = (icon: string | undefined, suggestionType: Fig.SuggestionType | undefined): string => {
    // TODO: enable fig icons once spacing is better
    // if (icon && /[^\u0000-\u00ff]/.test(icon)) {
    //   return icon;
    // }
    switch (suggestionType) {
        case "arg":
            return SuggestionIcons.Argument;
        case "file":
            return SuggestionIcons.File;
        case "folder":
            return SuggestionIcons.Folder;
        case "option":
            return SuggestionIcons.Option;
        case "subcommand":
            return SuggestionIcons.Subcommand;
        case "mixin":
            return SuggestionIcons.Mixin;
        case "shortcut":
            return SuggestionIcons.Shortcut;
        case "special":
            return SuggestionIcons.Special;
        default:
            return SuggestionIcons.Default;
    }
};

export type FilterStrategy = "fuzzy" | "prefix" | "default";
