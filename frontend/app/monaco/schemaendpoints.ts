// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import settingsSchema from "../../../schema/settings.json";
import connectionsSchema from "../../../schema/connections.json";
import aipresetsSchema from "../../../schema/aipresets.json";
import bgpresetsSchema from "../../../schema/bgpresets.json";
import tabvarspresetsSchema from "../../../schema/tabvarspresets.json";
import waveaiSchema from "../../../schema/waveai.json";
import widgetsSchema from "../../../schema/widgets.json";

type SchemaInfo = {
    uri: string;
    fileMatch: Array<string>;
    schema: object;
};

const MonacoSchemas: SchemaInfo[] = [
    {
        uri: "wave://schema/settings.json",
        fileMatch: ["*/WAVECONFIGPATH/settings.json"],
        schema: settingsSchema,
    },
    {
        uri: "wave://schema/connections.json",
        fileMatch: ["*/WAVECONFIGPATH/connections.json"],
        schema: connectionsSchema,
    },
    {
        uri: "wave://schema/aipresets.json",
        fileMatch: ["*/WAVECONFIGPATH/presets/ai.json"],
        schema: aipresetsSchema,
    },
    {
        uri: "wave://schema/bgpresets.json",
        fileMatch: ["*/WAVECONFIGPATH/presets/bg.json"],
        schema: bgpresetsSchema,
    },
    {
        uri: "wave://schema/tabvarspresets.json",
        fileMatch: ["*/WAVECONFIGPATH/presets/tabvars.json", "*/WAVECONFIGPATH/presets/tabvars/*.json"],
        schema: tabvarspresetsSchema,
    },
    {
        uri: "wave://schema/waveai.json",
        fileMatch: ["*/WAVECONFIGPATH/waveai.json"],
        schema: waveaiSchema,
    },
    {
        uri: "wave://schema/widgets.json",
        fileMatch: ["*/WAVECONFIGPATH/widgets.json"],
        schema: widgetsSchema,
    },
];

export { MonacoSchemas };
