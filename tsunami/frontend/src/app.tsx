// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TsunamiModel } from "@/model/tsunami-model";
import { VDomView } from "./vdom";

const globalModel = new TsunamiModel();

function App() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <VDomView model={globalModel} />
        </div>
    );
}

export default App;
