// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from "react";
import { TsunamiModel } from "@/model/tsunami-model";
import { VDomView } from "./vdom";

function App() {
    const [remountKey, setRemountKey] = useState(0);
    const [model, setModel] = useState(() => {
        const newModel = new TsunamiModel();
        newModel.remountCallback = () => {
            setRemountKey(prev => prev + 1);
        };
        return newModel;
    });

    useEffect(() => {
        // Create a new model when remount key changes
        if (remountKey > 0) {
            const newModel = new TsunamiModel();
            newModel.remountCallback = () => {
                setRemountKey(prev => prev + 1);
            };
            setModel(newModel);
        }
    }, [remountKey]);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <VDomView key={remountKey} model={model} />
        </div>
    );
}

export default App;
