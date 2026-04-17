// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TsunamiModel } from "@/model/tsunami-model";
import { VDomView } from "./vdom";

// Global model instance
const globalModel = new TsunamiModel();

function App() {
    return (
        <div className="h-full bg-background text-foreground overflow-auto">
            <VDomView model={globalModel} />
        </div>
    );
}

export default App;
