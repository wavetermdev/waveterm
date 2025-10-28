// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";

type EnvVar = {
    name: string;
    value: string;
};

const BuilderEnvTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderId = useAtomValue(atoms.builderId);
    const envVarsObj = useAtomValue(model.envVarsAtom);
    const error = useAtomValue(model.errorAtom);

    const [envVars, setEnvVars] = useState<EnvVar[]>([]);

    useEffect(() => {
        setEnvVars(Object.entries(envVarsObj).map(([name, value]) => ({ name, value })));
    }, [envVarsObj]);

    const updateModel = useCallback((vars: EnvVar[]) => {
        const obj: Record<string, string> = {};
        vars.forEach((v) => {
            if (v.name.trim()) {
                obj[v.name] = v.value;
            }
        });
        model.setEnvVars(obj);
    }, [model]);

    const handleAddVar = useCallback(() => {
        const newVars = [...envVars, { name: "", value: "" }];
        setEnvVars(newVars);
    }, [envVars]);

    const handleRemoveVar = useCallback((index: number) => {
        const newVars = envVars.filter((_, i) => i !== index);
        setEnvVars(newVars);
        updateModel(newVars);
    }, [envVars, updateModel]);

    const handleNameChange = useCallback((index: number, name: string) => {
        const newVars = [...envVars];
        newVars[index] = { ...newVars[index], name };
        setEnvVars(newVars);
        updateModel(newVars);
    }, [envVars, updateModel]);

    const handleValueChange = useCallback((index: number, value: string) => {
        const newVars = [...envVars];
        newVars[index] = { ...newVars[index], value };
        setEnvVars(newVars);
        updateModel(newVars);
    }, [envVars, updateModel]);

    return (
        <div className="w-full h-full flex flex-col p-4">
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">Environment Variables</h2>
                <button
                    className="px-3 py-1 text-sm font-medium rounded bg-accent text-white hover:brightness-110 cursor-pointer"
                    onClick={handleAddVar}
                >
                    Add Variable
                </button>
            </div>

            <div className="mb-4 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-secondary">
                These environment variables are transient and only used during builder testing. They are not bundled with the app.
            </div>

            {error && (
                <div className="mb-4 p-2 bg-red-500/20 text-red-500 rounded text-sm">
                    {error}
                </div>
            )}

            <div className="flex-1 overflow-auto">
                <div className="space-y-2">
                    {envVars.length === 0 ? (
                        <div className="text-secondary text-center py-8">
                            No environment variables defined. Click "Add Variable" to create one.
                        </div>
                    ) : (
                        envVars.map((envVar, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={envVar.name}
                                    onChange={(e) => handleNameChange(index, e.target.value)}
                                    placeholder="Variable Name"
                                    className="flex-1 px-3 py-2 bg-background border border-border rounded text-primary focus:outline-none focus:border-accent"
                                />
                                <input
                                    type="text"
                                    value={envVar.value}
                                    onChange={(e) => handleValueChange(index, e.target.value)}
                                    placeholder="Value"
                                    className="flex-1 px-3 py-2 bg-background border border-border rounded text-primary focus:outline-none focus:border-accent"
                                />
                                <button
                                    className="px-3 py-2 text-sm font-medium rounded bg-red-500/20 text-red-500 hover:brightness-110 cursor-pointer"
                                    onClick={() => handleRemoveVar(index)}
                                >
                                    Remove
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
});

BuilderEnvTab.displayName = "BuilderEnvTab";

export { BuilderEnvTab };