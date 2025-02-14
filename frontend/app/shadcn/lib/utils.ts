// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// This file is based on components from shadcn/ui, which is licensed under the MIT License.
// Original source: https://github.com/shadcn/ui
// Modifications made by Command Line Inc.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDate(input: string | number): string {
    const date = new Date(input);
    return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

export function absoluteUrl(path: string) {
    return `${process.env.NEXT_PUBLIC_APP_URL}${path}`;
}
