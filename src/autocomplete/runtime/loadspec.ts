// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/runtime.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import speclist, {
    diffVersionedCompletions as versionedSpeclist,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
} from "@withfig/autocomplete/build/index";
import log from "../utils/log";
import { buildExecuteShellCommand, mergeSubcomands } from "./utils";

const specSet: Record<string, string> = {};

(speclist as string[]).forEach((s) => {
    const suffix = versionedSpeclist.includes(s) ? "/index.js" : `.js`;
    specSet[s] = `${s}${suffix}`;
});

const loadedSpecs: Record<string, Fig.Spec> = {};

/**
 * Loads the spec for the current command. If the spec has been loaded already, it will be returned.
 * If the command defines a `loadSpec` function, that function is run and the result is set as the new spec.
 * Otherwise, the spec is set to the command itself.
 * @param specName The name of the spec to load.
 * @param entries The entries to pass to the spec's `generateSpec` function, if it exists.
 * @returns The loaded spec, or undefined if the spec could not be loaded.
 */
export const loadSpec = async (specName: string, entries: string[]): Promise<Fig.Spec | undefined> => {
    if (!specName) {
        log.debug("specName empty, returning undefined");
        return;
    }

    try {
        log.debug("loading spec: ", specName);

        let spec: any;

        if (loadedSpecs[specName]) {
            log.debug("loaded spec found");
            return loadedSpecs[specName];
        }
        if (specSet[specName]) {
            log.debug("loading spec");
            spec = await import(`@withfig/autocomplete/build/${specSet[specName]}`);
        } else {
            log.debug("no spec found, returning undefined");
            return;
        }

        if (Object.hasOwn(spec, "getVersionCommand") && typeof spec.getVersionCommand === "function") {
            log.debug("has getVersionCommand fn");
            const commandVersion = await (spec.getVersionCommand as Fig.GetVersionCommand)(
                buildExecuteShellCommand(5000)
            );
            log.debug("commandVersion: " + commandVersion);
            log.debug("returning as version is not supported");
            return;
        }
        if (typeof spec.default === "object") {
            const command = spec.default as Fig.Subcommand;
            log.debug("Spec is valid Subcommand", command);
            if (command.generateSpec) {
                log.debug("has generateSpec function");
                const generatedSpec = await command.generateSpec(entries, buildExecuteShellCommand(5000));
                log.debug("generatedSpec: ", generatedSpec);
                spec = mergeSubcomands(command, generatedSpec);
            } else {
                log.debug("no generateSpec function");
                spec = command;
            }
            loadedSpecs[specName] = spec;
            return spec;
        } else {
            log.debug("Spec is not valid Subcommand");
            return;
        }
    } catch (e) {
        console.warn("import failed: ", e);
    }
};

// this load spec function should only be used for `loadSpec` on the fly as it is cacheless
export const lazyLoadSpec = async (key: string): Promise<Fig.Spec | undefined> => {
    return (await import(`@withfig/autocomplete/build/${key}.js`)).default;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be implemented in below TODO
export const lazyLoadSpecLocation = async (location: Fig.SpecLocation): Promise<Fig.Spec | undefined> => {
    return; //TODO: implement spec location loading
};

/**
 * Returns the subcommand from a spec if it exists.
 * @param spec The spec to get the subcommand from.
 * @returns The subcommand, or undefined if the spec does not contain a subcommand.
 */
export const getSubcommand = (spec?: Fig.Spec): Fig.Subcommand | undefined => {
    // TODO: handle subcommands that are versioned
    if (spec == null) return;
    if (typeof spec === "function") {
        const potentialSubcommand = spec();
        if (Object.hasOwn(potentialSubcommand, "name")) {
            return potentialSubcommand as Fig.Subcommand;
        }
        return;
    }
    return spec;
};
