// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import aipresetsSchema from "../../../schema/aipresets.json";
import backgroundsSchema from "../../../schema/backgrounds.json";
import connectionsSchema from "../../../schema/connections.json";
import settingsSchema from "../../../schema/settings.json";
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
        uri: "wave://schema/backgrounds.json",
        fileMatch: ["*/WAVECONFIGPATH/backgrounds.json"],
        schema: backgroundsSchema,
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
