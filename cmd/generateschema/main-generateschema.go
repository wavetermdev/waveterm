// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/invopop/jsonschema"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const WaveSchemaSettingsFileName = "schema/settings.json"

func main() {
	settingsSchema := jsonschema.Reflect(&wconfig.SettingsType{})

	jsonSettingsSchema, err := json.MarshalIndent(settingsSchema, "", "  ")
	if err != nil {
		log.Fatalf("failed to parse local schema: %v", err)
	}
	/*
		err = os.MkdirAll(WaveSchemaSettingsFileName, 0755)
		if err != nil {
			log.Fatalf("failed to create schema dir: %v", err)
		}
	*/
	written, err := utilfn.WriteFileIfDifferent(WaveSchemaSettingsFileName, jsonSettingsSchema)
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", WaveSchemaSettingsFileName)
	}
	if err != nil {
		log.Fatalf("failed to write local schema: %v", err)
	}
}
