// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "react-i18next";
import { resources } from "./resources";

declare module "react-i18next" {
    interface CustomTypeOptions {
        defaultNS: "common";
        resources: (typeof resources)["en"];
    }
}
