// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestParseSetConfigInput(t *testing.T) {
	input := map[string]any{
		"config": map[string]any{
			"web:defaulturl": "https://example.com",
		},
	}

	parsedInput, err := parseSetConfigInput(input)
	if err != nil {
		t.Fatalf("parseSetConfigInput failed: %v", err)
	}
	if parsedInput.Config["web:defaulturl"] != "https://example.com" {
		t.Fatalf("expected web:defaulturl to be preserved, got %#v", parsedInput.Config["web:defaulturl"])
	}

	_, err = parseSetConfigInput(map[string]any{})
	if err == nil {
		t.Fatalf("expected missing config error")
	}
}

func TestVerifySetConfigInputRejectsUnsafeKeysAndTypes(t *testing.T) {
	err := verifySetConfigInput(map[string]any{
		"config": map[string]any{
			"ai:apitoken": "secret",
		},
	}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected ai:apitoken to be rejected")
	}

	err = verifySetConfigInput(map[string]any{
		"config": map[string]any{
			"term:fontsize": "large",
		},
	}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected invalid term:fontsize type to be rejected")
	}

	err = verifySetConfigInput(map[string]any{
		"config": map[string]any{
			"app:tabbar": "bottom",
		},
	}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected invalid app:tabbar enum to be rejected")
	}
}

func TestSetConfigCallbackWritesAndRemovesConfig(t *testing.T) {
	tmpConfigDir, err := os.MkdirTemp("", "setconfig-tool")
	if err != nil {
		t.Fatalf("failed to create temp config dir: %v", err)
	}
	defer os.RemoveAll(tmpConfigDir)

	err = os.MkdirAll(tmpConfigDir, 0755)
	if err != nil {
		t.Fatalf("failed to create config dir: %v", err)
	}

	oldConfigHome := wavebase.ConfigHome_VarCache
	defer func() {
		wavebase.ConfigHome_VarCache = oldConfigHome
	}()
	wavebase.ConfigHome_VarCache = tmpConfigDir

	toolUse := &uctypes.UIMessageDataToolUse{}
	_, err = setConfigCallback(map[string]any{
		"config": map[string]any{
			"web:defaulturl": "https://example.com",
			"term:fontsize":  14.0,
			"term:copyonselect": true,
		},
	}, toolUse)
	if err != nil {
		t.Fatalf("setConfigCallback failed: %v", err)
	}

	configFile := filepath.Join(tmpConfigDir, wconfig.SettingsFile)
	if _, err := os.Stat(configFile); err != nil {
		t.Fatalf("expected settings file to be written: %v", err)
	}

	storedConfig, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.SettingsFile)
	if len(cerrs) > 0 {
		t.Fatalf("unexpected config read errors: %v", cerrs)
	}
	if storedConfig["web:defaulturl"] != "https://example.com" {
		t.Fatalf("expected web:defaulturl to be written, got %#v", storedConfig["web:defaulturl"])
	}
	if storedConfig["term:fontsize"] != float64(14) {
		t.Fatalf("expected term:fontsize to be 14, got %#v", storedConfig["term:fontsize"])
	}
	if storedConfig["term:copyonselect"] != true {
		t.Fatalf("expected term:copyonselect to be true, got %#v", storedConfig["term:copyonselect"])
	}

	_, err = setConfigCallback(map[string]any{
		"config": map[string]any{
			"web:defaulturl": nil,
		},
	}, toolUse)
	if err != nil {
		t.Fatalf("setConfigCallback remove failed: %v", err)
	}

	storedConfig, cerrs = wconfig.ReadWaveHomeConfigFile(wconfig.SettingsFile)
	if len(cerrs) > 0 {
		t.Fatalf("unexpected config read errors after remove: %v", cerrs)
	}
	if _, ok := storedConfig["web:defaulturl"]; ok {
		t.Fatalf("expected web:defaulturl to be removed")
	}
}

func TestGetSetConfigToolDefinition(t *testing.T) {
	toolDef := GetSetConfigToolDefinition()

	if toolDef.Name != SetConfigToolName {
		t.Fatalf("expected tool name %q, got %q", SetConfigToolName, toolDef.Name)
	}
	if toolDef.ToolLogName != "app:setconfig" {
		t.Fatalf("expected tool log name app:setconfig, got %q", toolDef.ToolLogName)
	}
	if toolDef.ToolAnyCallback == nil {
		t.Fatalf("ToolAnyCallback should not be nil")
	}
	if toolDef.ToolVerifyInput == nil {
		t.Fatalf("ToolVerifyInput should not be nil")
	}
	if toolDef.ToolApproval == nil {
		t.Fatalf("ToolApproval should not be nil")
	}

	properties, ok := toolDef.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("tool input schema properties should be a map")
	}
	configSchema, ok := properties["config"].(map[string]any)
	if !ok {
		t.Fatalf("config schema should be a map")
	}
	configProperties, ok := configSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("config schema properties should be a map")
	}
	if _, ok := configProperties["web:defaulturl"]; !ok {
		t.Fatalf("expected whitelisted key web:defaulturl in schema")
	}
	if _, ok := configProperties["ai:apitoken"]; ok {
		t.Fatalf("did not expect ai:apitoken in schema")
	}

	if approval := toolDef.ToolApproval(nil); approval != uctypes.ApprovalNeedsApproval {
		t.Fatalf("expected approval %q, got %q", uctypes.ApprovalNeedsApproval, approval)
	}
}
