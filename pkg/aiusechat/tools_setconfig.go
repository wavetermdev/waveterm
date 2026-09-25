// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const SetConfigToolName = "set_config"

type setConfigToolInput struct {
	Config waveobj.MetaMapType `json:"config"`
}

type setConfigAllowedValue struct {
	Schema       map[string]any
	ValidateFunc func(any) error
}

var setConfigAllowedSettings = map[string]setConfigAllowedValue{
	"app:defaultnewblock": {
		Schema:       makeNullableStringSchema("Default widget type used for newly created blocks."),
		ValidateFunc: validateConfigStringValue(nil),
	},
	"app:showoverlayblocknums": {
		Schema:       makeNullableBoolSchema("Show block number overlays in the UI."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"app:ctrlvpaste": {
		Schema:       makeNullableBoolSchema("Enable Ctrl+V paste behavior."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"app:confirmquit": {
		Schema:       makeNullableBoolSchema("Ask for confirmation before quitting Wave."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"app:hideaibutton": {
		Schema:       makeNullableBoolSchema("Hide the AI button in the UI."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"app:disablectrlshiftarrows": {
		Schema:       makeNullableBoolSchema("Disable Ctrl+Shift+Arrow shortcuts."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"app:disablectrlshiftdisplay": {
		Schema:       makeNullableBoolSchema("Disable Ctrl+Shift display shortcuts."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"app:focusfollowscursor": {
		Schema:       makeNullableEnumStringSchema("Control whether focus follows the cursor.", "off", "on", "term"),
		ValidateFunc: validateConfigStringValue([]string{"off", "on", "term"}),
	},
	"app:tabbar": {
		Schema:       makeNullableEnumStringSchema("Choose where the tab bar is shown.", "top", "left"),
		ValidateFunc: validateConfigStringValue([]string{"top", "left"}),
	},
	"feature:waveappbuilder": {
		Schema:       makeNullableBoolSchema("Enable or disable the Wave app builder feature."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"waveai:showcloudmodes": {
		Schema:       makeNullableBoolSchema("Show Wave cloud AI modes in the mode picker."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"waveai:defaultmode": {
		Schema:       makeNullableStringSchema("Default Wave AI mode to select."),
		ValidateFunc: validateConfigStringValue(nil),
	},
	"term:fontsize": {
		Schema:       makeNullableNumberSchema("Terminal font size."),
		ValidateFunc: validateConfigNumberValue(),
	},
	"term:fontfamily": {
		Schema:       makeNullableStringSchema("Terminal font family."),
		ValidateFunc: validateConfigStringValue(nil),
	},
	"term:theme": {
		Schema:       makeNullableStringSchema("Terminal theme name."),
		ValidateFunc: validateConfigStringValue(nil),
	},
	"term:disablewebgl": {
		Schema:       makeNullableBoolSchema("Disable terminal WebGL rendering."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:copyonselect": {
		Schema:       makeNullableBoolSchema("Copy terminal selections automatically."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:allowbracketedpaste": {
		Schema:       makeNullableBoolSchema("Allow bracketed paste in the terminal."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:shiftenternewline": {
		Schema:       makeNullableBoolSchema("Insert a newline when Shift+Enter is pressed."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:macoptionismeta": {
		Schema:       makeNullableBoolSchema("Treat the Mac Option key as Meta."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:cursor": {
		Schema:       makeNullableStringSchema("Terminal cursor style."),
		ValidateFunc: validateConfigStringValue(nil),
	},
	"term:cursorblink": {
		Schema:       makeNullableBoolSchema("Enable cursor blinking in the terminal."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:bellsound": {
		Schema:       makeNullableBoolSchema("Enable terminal bell sounds."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:bellindicator": {
		Schema:       makeNullableBoolSchema("Enable terminal bell indicators."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"term:osc52": {
		Schema:       makeNullableEnumStringSchema("Terminal OSC52 clipboard behavior.", "focus", "always"),
		ValidateFunc: validateConfigStringValue([]string{"focus", "always"}),
	},
	"term:durable": {
		Schema:       makeNullableBoolSchema("Keep terminal state durable across reloads."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"editor:minimapenabled": {
		Schema:       makeNullableBoolSchema("Show the code editor minimap."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"editor:stickyscrollenabled": {
		Schema:       makeNullableBoolSchema("Enable sticky scroll in the code editor."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"editor:wordwrap": {
		Schema:       makeNullableBoolSchema("Enable word wrap in the code editor."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"editor:fontsize": {
		Schema:       makeNullableNumberSchema("Code editor font size."),
		ValidateFunc: validateConfigNumberValue(),
	},
	"editor:inlinediff": {
		Schema:       makeNullableBoolSchema("Show code diffs inline in the editor."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"web:openlinksinternally": {
		Schema:       makeNullableBoolSchema("Open web links inside Wave."),
		ValidateFunc: validateConfigBoolValue(),
	},
	"web:defaulturl": {
		Schema:       makeNullableStringSchema("Default URL for new web widgets."),
		ValidateFunc: validateConfigStringValue(nil),
	},
	"web:defaultsearch": {
		Schema:       makeNullableStringSchema("Default search URL template for web widgets."),
		ValidateFunc: validateConfigStringValue(nil),
	},
}

func makeNullableBoolSchema(description string) map[string]any {
	return map[string]any{
		"anyOf": []any{
			map[string]any{
				"type":        "boolean",
				"description": description,
			},
			map[string]any{
				"type": "null",
			},
		},
	}
}

func makeNullableNumberSchema(description string) map[string]any {
	return map[string]any{
		"anyOf": []any{
			map[string]any{
				"type":        "number",
				"description": description,
			},
			map[string]any{
				"type": "null",
			},
		},
	}
}

func makeNullableStringSchema(description string) map[string]any {
	return map[string]any{
		"anyOf": []any{
			map[string]any{
				"type":        "string",
				"description": description,
			},
			map[string]any{
				"type": "null",
			},
		},
	}
}

func makeNullableEnumStringSchema(description string, values ...string) map[string]any {
	return map[string]any{
		"anyOf": []any{
			map[string]any{
				"type":        "string",
				"description": description,
				"enum":        values,
			},
			map[string]any{
				"type": "null",
			},
		},
	}
}

func validateConfigBoolValue() func(any) error {
	return func(val any) error {
		if val == nil {
			return nil
		}
		if _, ok := val.(bool); !ok {
			return fmt.Errorf("must be a boolean or null")
		}
		return nil
	}
}

func validateConfigNumberValue() func(any) error {
	return func(val any) error {
		if val == nil {
			return nil
		}
		if _, ok := val.(float64); !ok {
			return fmt.Errorf("must be a number or null")
		}
		return nil
	}
}

func validateConfigStringValue(enumValues []string) func(any) error {
	return func(val any) error {
		if val == nil {
			return nil
		}
		strVal, ok := val.(string)
		if !ok {
			return fmt.Errorf("must be a string or null")
		}
		if len(enumValues) == 0 {
			return nil
		}
		for _, enumVal := range enumValues {
			if strVal == enumVal {
				return nil
			}
		}
		return fmt.Errorf("must be one of: %s", strings.Join(enumValues, ", "))
	}
}

func parseSetConfigInput(input any) (*setConfigToolInput, error) {
	result := &setConfigToolInput{}
	if input == nil {
		return nil, fmt.Errorf("input is required")
	}
	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}
	if len(result.Config) == 0 {
		return nil, fmt.Errorf("config must contain at least one setting")
	}
	return result, nil
}

func validateSetConfigInput(input any) (*setConfigToolInput, error) {
	result, err := parseSetConfigInput(input)
	if err != nil {
		return nil, err
	}
	for configKey, val := range result.Config {
		allowedSetting, ok := setConfigAllowedSettings[configKey]
		if !ok {
			return nil, fmt.Errorf("config key %q is not allowed", configKey)
		}
		if err := allowedSetting.ValidateFunc(val); err != nil {
			return nil, fmt.Errorf("invalid value for %s: %w", configKey, err)
		}
	}
	return result, nil
}

func verifySetConfigInput(input any, _ *uctypes.UIMessageDataToolUse) error {
	_, err := validateSetConfigInput(input)
	return err
}

func setConfigCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	parsedInput, err := validateSetConfigInput(input)
	if err != nil {
		return nil, err
	}
	err = wconfig.SetBaseConfigValue(parsedInput.Config)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"success":      true,
		"updated_keys": getSortedConfigKeys(parsedInput.Config),
	}, nil
}

func getSortedConfigKeys(config waveobj.MetaMapType) []string {
	keys := make([]string, 0, len(config))
	for key := range config {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func getSetConfigSchemaProperties() map[string]any {
	properties := make(map[string]any, len(setConfigAllowedSettings))
	for configKey, allowedSetting := range setConfigAllowedSettings {
		properties[configKey] = allowedSetting.Schema
	}
	return properties
}

func GetSetConfigToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        SetConfigToolName,
		DisplayName: "Set Wave Config",
		Description: "Update a small whitelist of safe Wave configuration settings. Use null to remove a setting and restore its default behavior.",
		ToolLogName: "app:setconfig",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"config": map[string]any{
					"type":                 "object",
					"description":          "Configuration key/value pairs to update. Only the listed keys are allowed.",
					"properties":           getSetConfigSchemaProperties(),
					"additionalProperties": false,
					"minProperties":        1,
				},
			},
			"required":             []string{"config"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsedInput, err := parseSetConfigInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("updating Wave config keys: %s", strings.Join(getSortedConfigKeys(parsedInput.Config), ", "))
		},
		ToolAnyCallback: setConfigCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
		ToolVerifyInput: verifySetConfigInput,
	}
}
