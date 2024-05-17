// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "./quickelems.less";

function CenteredDiv({ children }: { children: React.ReactNode }) {
    return (
        <div className="centered-div">
            <div>{children}</div>
        </div>
    );
}

export { CenteredDiv as CenteredDiv };
