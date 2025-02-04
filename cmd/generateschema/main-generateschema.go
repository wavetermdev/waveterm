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
const WaveSchemaConnectionsFileName = "schema/connections.json"

func generateSettingsSchema() error {
	settingsSchema := jsonschema.Reflect(&wconfig.SettingsType{})

	jsonSettingsSchema, err := json.MarshalIndent(settingsSchema, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to parse local schema: %v", err)
	}
	written, err := utilfn.WriteFileIfDifferent(WaveSchemaSettingsFileName, jsonSettingsSchema)
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", WaveSchemaSettingsFileName)
	}
	if err != nil {
		return fmt.Errorf("failed to write local schema: %v", err)
	}
	return nil
}

func generateConnectionsSchema() error {
	connExample := make(map[string]wconfig.ConnKeywords)
	connectionSchema := jsonschema.Reflect(connExample)

	jsonSettingsSchema, err := json.MarshalIndent(connectionSchema, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to parse local schema: %v", err)
	}
	written, err := utilfn.WriteFileIfDifferent(WaveSchemaConnectionsFileName, jsonSettingsSchema)
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", WaveSchemaConnectionsFileName)
	}
	if err != nil {
		return fmt.Errorf("failed to write local schema: %v", err)
	}
	return nil
}

func main() {
	err := generateSettingsSchema()
	if err != nil {
		log.Fatalf("settings schema error: %v", err)
	}
	err = generateConnectionsSchema()
	if err != nil {
		log.Fatalf("connections schema error: %v", err)
	}
}
