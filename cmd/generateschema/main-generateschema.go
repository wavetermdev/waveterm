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
const WaveSchemaAiPresetsFileName = "schema/aipresets.json"
const WaveSchemaWidgetsFileName = "schema/widgets.json"
const WaveSchemaBgPresetsFileName = "schema/bgpresets.json"
const WaveSchemaWaveAIFileName = "schema/waveai.json"

func generateSchema(template any, dir string) error {
	settingsSchema := jsonschema.Reflect(template)

	jsonSettingsSchema, err := json.MarshalIndent(settingsSchema, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to parse local schema: %w", err)
	}
	written, err := utilfn.WriteFileIfDifferent(dir, jsonSettingsSchema)
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", dir)
	}
	if err != nil {
		return fmt.Errorf("failed to write local schema: %w", err)
	}
	return nil
}

func main() {
	err := generateSchema(&wconfig.SettingsType{}, WaveSchemaSettingsFileName)
	if err != nil {
		log.Fatalf("settings schema error: %v", err)
	}

	connectionTemplate := make(map[string]wconfig.ConnKeywords)
	err = generateSchema(&connectionTemplate, WaveSchemaConnectionsFileName)
	if err != nil {
		log.Fatalf("connections schema error: %v", err)
	}

	aiPresetsTemplate := make(map[string]wconfig.AiSettingsType)
	err = generateSchema(&aiPresetsTemplate, WaveSchemaAiPresetsFileName)
	if err != nil {
		log.Fatalf("ai presets schema error: %v", err)
	}

	widgetsTemplate := make(map[string]wconfig.WidgetConfigType)
	err = generateSchema(&widgetsTemplate, WaveSchemaWidgetsFileName)
	if err != nil {
		log.Fatalf("widgets schema error: %v", err)
	}

	bgPresetsTemplate := make(map[string]wconfig.BgPresetsType)
	err = generateSchema(&bgPresetsTemplate, WaveSchemaBgPresetsFileName)
	if err != nil {
		log.Fatalf("bg presets schema error: %v", err)
	}

	waveAITemplate := make(map[string]wconfig.AIModeConfigType)
	err = generateSchema(&waveAITemplate, WaveSchemaWaveAIFileName)
	if err != nil {
		log.Fatalf("waveai schema error: %v", err)
	}
}
