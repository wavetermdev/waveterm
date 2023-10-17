// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare module "*.svg" {
    import React from "react";
    export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>;
    const content: any;
    export default content;
}
