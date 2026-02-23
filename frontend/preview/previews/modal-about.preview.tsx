// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AboutModalV } from "@/app/modals/about";

export function AboutModalPreview() {
    return (
        <AboutModalV
            versionString="0.11.0 (1740000000)"
            updaterChannel="stable"
            onClose={() => console.log("close")}
        />
    );
}
