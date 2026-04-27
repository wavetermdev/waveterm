// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isPreviewWindow } from "@/app/store/windowtype";
import React from "react";

type MockBoundaryProps = {
    fallback: React.ReactNode;
    children: React.ReactNode;
};

export function MockBoundary({ fallback, children }: MockBoundaryProps) {
    if (isPreviewWindow()) {
        return <>{fallback}</>;
    }
    return <>{children}</>;
}
