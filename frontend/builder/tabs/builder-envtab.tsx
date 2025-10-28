// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { useAtomValue } from "jotai";
import { memo } from "react";

type EnvVarRowProps = {
    model: BuilderAppPanelModel;
    index: number;
};

const EnvVarRow = memo(({ model, index }: EnvVarRowProps) => {
    const envVar = useAtomValue(model.getEnvVarIndexAtom(index));

    if (!envVar) {
        return null;
    }

    const isValueVisible = envVar.visible ?? false;

    return (
        <div className="flex items-center gap-2">
            <input
                type="text"
                value={envVar.name}
                onChange={(e) => model.setEnvVarAtIndex(index, { ...envVar, name: e.target.value }, true)}
                placeholder="Variable Name"
                className="flex-1 px-3 py-2 bg-background border border-border rounded text-primary focus:outline-none focus:border-accent"
            />
            <div className="flex-1 relative">
                <input
                    type={isValueVisible ? "text" : "password"}
                    value={envVar.value}
                    onChange={(e) => model.setEnvVarAtIndex(index, { ...envVar, value: e.target.value }, true)}
                    placeholder="Value"
                    className="w-full px-3 py-2 pr-10 bg-background border border-border rounded text-primary focus:outline-none focus:border-accent"
                />
                <button
                    type="button"
                    onClick={() => model.setEnvVarAtIndex(index, { ...envVar, visible: !isValueVisible }, false)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary cursor-pointer transition-colors"
                    title={isValueVisible ? "Hide value" : "Show value"}
                >
                    <i className={`fa-solid ${isValueVisible ? "fa-eye" : "fa-eye-slash"}`} />
                </button>
            </div>
            <button
                className="px-3 py-2 text-sm font-medium rounded bg-red-500/20 text-red-500 hover:brightness-110 cursor-pointer"
                onClick={() => {
                    model.removeEnvVar(index);
                }}
            >
                Remove
            </button>
        </div>
    );
});

EnvVarRow.displayName = "EnvVarRow";

const BuilderEnvTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const envVars = useAtomValue(model.envVarsArrayAtom);
    const error = useAtomValue(model.errorAtom);

    return (
        <div className="w-full h-full flex flex-col p-4">
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">Environment Variables</h2>
                <button
                    className="px-3 py-1 text-sm font-medium rounded bg-accent text-white hover:brightness-110 cursor-pointer"
                    onClick={() => model.addEnvVar()}
                >
                    Add Variable
                </button>
            </div>

            <div className="mb-4 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-secondary">
                These environment variables are transient and only used during builder testing. They are not bundled
                with the app.
            </div>

            {error && <div className="mb-4 p-2 bg-red-500/20 text-red-500 rounded text-sm">{error}</div>}

            <div className="flex-1 overflow-auto">
                <div className="space-y-2">
                    {envVars.length === 0 ? (
                        <div className="text-secondary text-center py-8">
                            No environment variables defined. Click "Add Variable" to create one.
                        </div>
                    ) : (
                        envVars.map((_, index) => <EnvVarRow key={index} model={model} index={index} />)
                    )}
                </div>
            </div>
        </div>
    );
});

BuilderEnvTab.displayName = "BuilderEnvTab";

export { BuilderEnvTab };
