// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"reflect"

	"github.com/invopop/jsonschema"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const WaveSchemaSettingsFileName = "schema/settings.json"
const WaveSchemaConnectionsFileName = "schema/connections.json"
const WaveSchemaAiPresetsFileName = "schema/aipresets.json"
const WaveSchemaWidgetsFileName = "schema/widgets.json"
const WaveSchemaBgPresetsFileName = "schema/bgpresets.json"
const WaveSchemaWaveAIFileName = "schema/waveai.json"

// ViewNameType is a string type whose JSON Schema offers enum suggestions for the most
// common widget view names while still accepting any arbitrary string value.
type ViewNameType string

func (ViewNameType) JSONSchema() *jsonschema.Schema {
	return &jsonschema.Schema{
		AnyOf: []*jsonschema.Schema{
			{
				Enum: []any{"term", "preview", "web", "sysinfo", "launcher"},
			},
			{
				Type: "string",
			},
		},
	}
}

// ControllerNameType is a string type whose JSON Schema offers enum suggestions for the
// known block controller names while still accepting any arbitrary string value.
type ControllerNameType string

func (ControllerNameType) JSONSchema() *jsonschema.Schema {
	return &jsonschema.Schema{
		AnyOf: []*jsonschema.Schema{
			{
				Enum: []any{"shell", "cmd"},
			},
			{
				Type: "string",
			},
		},
	}
}

// WidgetsMetaSchemaHints provides schema hints for the blockdef.meta field in widget configs.
// It covers the most common keys used when defining widgets: view, file, url, controller,
// cmd and cmd:* options, and term:* options.
type WidgetsMetaSchemaHints struct {
	View       ViewNameType       `json:"view,omitempty"`
	File       string             `json:"file,omitempty"`
	Url        string             `json:"url,omitempty"`
	Controller ControllerNameType `json:"controller,omitempty"`

	Cmd                 string            `json:"cmd,omitempty"`
	CmdInteractive      bool              `json:"cmd:interactive,omitempty"`
	CmdLogin            bool              `json:"cmd:login,omitempty"`
	CmdPersistent       bool              `json:"cmd:persistent,omitempty"`
	CmdRunOnStart       bool              `json:"cmd:runonstart,omitempty"`
	CmdClearOnStart     bool              `json:"cmd:clearonstart,omitempty"`
	CmdRunOnce          bool              `json:"cmd:runonce,omitempty"`
	CmdCloseOnExit      bool              `json:"cmd:closeonexit,omitempty"`
	CmdCloseOnExitForce bool              `json:"cmd:closeonexitforce,omitempty"`
	CmdCloseOnExitDelay float64           `json:"cmd:closeonexitdelay,omitempty"`
	CmdNoWsh            bool              `json:"cmd:nowsh,omitempty"`
	CmdArgs             []string          `json:"cmd:args,omitempty"`
	CmdShell            bool              `json:"cmd:shell,omitempty"`
	CmdAllowConnChange  bool              `json:"cmd:allowconnchange,omitempty"`
	CmdEnv              map[string]string `json:"cmd:env,omitempty"`
	CmdCwd              string            `json:"cmd:cwd,omitempty"`
	CmdInitScript       string            `json:"cmd:initscript,omitempty"`
	CmdInitScriptSh     string            `json:"cmd:initscript.sh,omitempty"`
	CmdInitScriptBash   string            `json:"cmd:initscript.bash,omitempty"`
	CmdInitScriptZsh    string            `json:"cmd:initscript.zsh,omitempty"`
	CmdInitScriptPwsh   string            `json:"cmd:initscript.pwsh,omitempty"`
	CmdInitScriptFish   string            `json:"cmd:initscript.fish,omitempty"`

	TermFontSize            int      `json:"term:fontsize,omitempty"`
	TermFontFamily          string   `json:"term:fontfamily,omitempty"`
	TermMode                string   `json:"term:mode,omitempty"`
	TermTheme               string   `json:"term:theme,omitempty"`
	TermLocalShellPath      string   `json:"term:localshellpath,omitempty"`
	TermLocalShellOpts      []string `json:"term:localshellopts,omitempty"`
	TermScrollback          *int     `json:"term:scrollback,omitempty"`
	TermTransparency        *float64 `json:"term:transparency,omitempty"`
	TermAllowBracketedPaste *bool    `json:"term:allowbracketedpaste,omitempty"`
	TermShiftEnterNewline   *bool    `json:"term:shiftenternewline,omitempty"`
	TermMacOptionIsMeta     *bool    `json:"term:macoptionismeta,omitempty"`
	TermBellSound           *bool    `json:"term:bellsound,omitempty"`
	TermBellIndicator       *bool    `json:"term:bellindicator,omitempty"`
	TermDurable             *bool    `json:"term:durable,omitempty"`
}

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

func generateWidgetsSchema(dir string) error {
	metaT := reflect.TypeOf(waveobj.MetaMapType(nil))

	// Build the hints schema once using an expanded reflector
	hr := &jsonschema.Reflector{
		DoNotReference:            true,
		ExpandedStruct:            true,
		AllowAdditionalProperties: true,
	}
	hintSchema := hr.Reflect(&WidgetsMetaSchemaHints{})

	r := &jsonschema.Reflector{}
	r.Mapper = func(t reflect.Type) *jsonschema.Schema {
		if t == metaT {
			return &jsonschema.Schema{
				Type:                 "object",
				Properties:           hintSchema.Properties,
				AdditionalProperties: jsonschema.TrueSchema,
			}
		}
		return nil
	}

	widgetsTemplate := make(map[string]wconfig.WidgetConfigType)
	widgetsSchema := r.Reflect(&widgetsTemplate)

	jsonWidgetsSchema, err := json.MarshalIndent(widgetsSchema, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to parse widgets schema: %w", err)
	}
	written, err := utilfn.WriteFileIfDifferent(dir, jsonWidgetsSchema)
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", dir)
	}
	if err != nil {
		return fmt.Errorf("failed to write widgets schema: %w", err)
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

	err = generateWidgetsSchema(WaveSchemaWidgetsFileName)
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
