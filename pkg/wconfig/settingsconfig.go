// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig/defaultconfig"
)

const SettingsFile = "settings.json"

type MetaSettingsType struct {
	waveobj.MetaMapType
}

func (m *MetaSettingsType) UnmarshalJSON(data []byte) error {
	var metaMap waveobj.MetaMapType
	if err := json.Unmarshal(data, &metaMap); err != nil {
		return err
	}
	*m = MetaSettingsType{MetaMapType: metaMap}
	return nil
}

func (m MetaSettingsType) MarshalJSON() ([]byte, error) {
	return json.Marshal(m.MetaMapType)
}

type SettingsType struct {
	AiClear     bool    `json:"ai:*,omitempty"`
	AiBaseURL   string  `json:"ai:baseurl,omitempty"`
	AiApiToken  string  `json:"ai:apitoken,omitempty"`
	AiName      string  `json:"ai:name,omitempty"`
	AiModel     string  `json:"ai:model,omitempty"`
	AiMaxTokens float64 `json:"ai:maxtokens,omitempty"`
	AiTimeoutMs float64 `json:"ai:timeoutms,omitempty"`

	TermClear        bool    `json:"term:*,omitempty"`
	TermFontSize     float64 `json:"term:fontsize,omitempty"`
	TermFontFamily   string  `json:"term:fontfamily,omitempty"`
	TermDisableWebGl bool    `json:"term:disablewebgl,omitempty"`

	EditorMinimapEnabled      bool `json:"editor:minimapenabled,omitempty"`
	EditorStickyScrollEnabled bool `json:"editor:stickyscrollenabled,omitempty"`

	WebClear               bool `json:"web:*,omitempty"`
	WebOpenLinksInternally bool `json:"web:openlinksinternally,omitempty"`

	BlockHeaderClear        bool `json:"blockheader:*,omitempty"`
	BlockHeaderShowBlockIds bool `json:"blockheader:showblockids,omitempty"`

	AutoUpdateClear         bool    `json:"autoupdate:*,omitempty"`
	AutoUpdateEnabled       bool    `json:"autoupdate:enabled,omitempty"`
	AutoUpdateIntervalMs    float64 `json:"autoupdate:intervalms,omitempty"`
	AutoUpdateInstallOnQuit bool    `json:"autoupdate:installonquit,omitempty"`
	AutoUpdateChannel       string  `json:"autoupdate:channel,omitempty"`

	WidgetClear    bool `json:"widget:*,omitempty"`
	WidgetShowHelp bool `json:"widget:showhelp,omitempty"`

	WindowClear         bool     `json:"window:*,omitempty"`
	WindowTransparent   bool     `json:"window:transparent,omitempty"`
	WindowBlur          bool     `json:"window:blur,omitempty"`
	WindowOpacity       *float64 `json:"window:opacity,omitempty"`
	WindowBgColor       string   `json:"window:bgcolor,omitempty"`
	WindowReducedMotion bool     `json:"window:reducedmotion,omitempty"`
	WindowTileGapSize   *int8    `json:"window:tilegapsize,omitempty"`

	TelemetryClear   bool `json:"telemetry:*,omitempty"`
	TelemetryEnabled bool `json:"telemetry:enabled,omitempty"`
}

type ConfigError struct {
	File string `json:"file"`
	Err  string `json:"err"`
}

type FullConfigType struct {
	Settings       SettingsType                   `json:"settings" merge:"meta"`
	MimeTypes      map[string]MimeTypeConfigType  `json:"mimetypes"`
	DefaultWidgets map[string]WidgetConfigType    `json:"defaultwidgets"`
	Widgets        map[string]WidgetConfigType    `json:"widgets"`
	Presets        map[string]waveobj.MetaMapType `json:"presets"`
	TermThemes     map[string]TermThemeType       `json:"termthemes"`
	ConfigErrors   []ConfigError                  `json:"configerrors" configfile:"-"`
}

var settingsAbsPath = filepath.Join(configDirAbsPath, SettingsFile)

func readConfigHelper(fileName string, barr []byte, readErr error) (waveobj.MetaMapType, []ConfigError) {
	var cerrs []ConfigError
	if readErr != nil && !os.IsNotExist(readErr) {
		cerrs = append(cerrs, ConfigError{File: "defaults:" + fileName, Err: readErr.Error()})
	}
	if len(barr) == 0 {
		return nil, cerrs
	}
	var rtn waveobj.MetaMapType
	err := json.Unmarshal(barr, &rtn)
	if err != nil {
		cerrs = append(cerrs, ConfigError{File: "defaults:" + fileName, Err: err.Error()})
	}
	return rtn, cerrs
}

func ReadDefaultsConfigFile(fileName string) (waveobj.MetaMapType, []ConfigError) {
	barr, readErr := defaultconfig.ConfigFS.ReadFile(fileName)
	return readConfigHelper("defaults:"+fileName, barr, readErr)
}

func ReadWaveHomeConfigFile(fileName string) (waveobj.MetaMapType, []ConfigError) {
	fullFileName := filepath.Join(configDirAbsPath, fileName)
	barr, err := os.ReadFile(fullFileName)
	return readConfigHelper(fullFileName, barr, err)
}

func WriteWaveHomeConfigFile(fileName string, m waveobj.MetaMapType) error {
	fullFileName := filepath.Join(configDirAbsPath, fileName)
	barr, err := jsonMarshalConfigInOrder(m)
	if err != nil {
		return err
	}
	return os.WriteFile(fullFileName, barr, 0644)
}

// simple merge that overwrites
func mergeMetaMapSimple(m waveobj.MetaMapType, toMerge waveobj.MetaMapType) waveobj.MetaMapType {
	if m == nil {
		return toMerge
	}
	if toMerge == nil {
		return m
	}
	for k, v := range toMerge {
		if v == nil {
			delete(m, k)
			continue
		}
		m[k] = v
	}
	if len(m) == 0 {
		return nil
	}
	return m
}

func ReadConfigPart(partName string, simpleMerge bool) (waveobj.MetaMapType, []ConfigError) {
	defConfig, cerrs1 := ReadDefaultsConfigFile(partName)
	userConfig, cerrs2 := ReadWaveHomeConfigFile(partName)
	allErrs := append(cerrs1, cerrs2...)
	if simpleMerge {
		return mergeMetaMapSimple(defConfig, userConfig), allErrs
	} else {
		return waveobj.MergeMeta(defConfig, userConfig, true), allErrs
	}
}

func ReadFullConfig() FullConfigType {
	var fullConfig FullConfigType
	configRType := reflect.TypeOf(fullConfig)
	configRVal := reflect.ValueOf(&fullConfig).Elem()
	for fieldIdx := 0; fieldIdx < configRType.NumField(); fieldIdx++ {
		field := configRType.Field(fieldIdx)
		if field.PkgPath != "" {
			continue
		}
		configFile := field.Tag.Get("configfile")
		if configFile == "-" {
			continue
		}
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag == "-" || jsonTag == "" {
			continue
		}
		simpleMerge := field.Tag.Get("merge") == ""
		fileName := jsonTag + ".json"
		configPart, cerrs := ReadConfigPart(fileName, simpleMerge)
		fullConfig.ConfigErrors = append(fullConfig.ConfigErrors, cerrs...)
		if configPart != nil {
			fieldPtr := configRVal.Field(fieldIdx).Addr().Interface()
			utilfn.ReUnmarshal(fieldPtr, configPart)
		}
	}
	return fullConfig
}

func getConfigKeyType(configKey string) reflect.Type {
	ctype := reflect.TypeOf(SettingsType{})
	for i := 0; i < ctype.NumField(); i++ {
		field := ctype.Field(i)
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag == configKey {
			return field.Type
		}
	}
	return nil
}

func getConfigKeyNamespace(key string) string {
	colonIdx := strings.Index(key, ":")
	if colonIdx == -1 {
		return ""
	}
	return key[:colonIdx]
}

func orderConfigKeys(m waveobj.MetaMapType) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		k1 := keys[i]
		k2 := keys[j]
		k1ns := getConfigKeyNamespace(k1)
		k2ns := getConfigKeyNamespace(k2)
		if k1ns != k2ns {
			return k1ns < k2ns
		}
		return k1 < k2
	})
	return keys
}

func reindentJson(barr []byte, indentStr string) []byte {
	if len(barr) < 2 {
		return barr
	}
	if barr[0] != '{' && barr[0] != '[' {
		return barr
	}
	if bytes.Index(barr, []byte("\n")) == -1 {
		return barr
	}
	outputLines := bytes.Split(barr, []byte("\n"))
	for i, line := range outputLines {
		if i == 0 || i == len(outputLines)-1 {
			continue
		}
		outputLines[i] = append([]byte(indentStr), line...)
	}
	return bytes.Join(outputLines, []byte("\n"))
}

func jsonMarshalConfigInOrder(m waveobj.MetaMapType) ([]byte, error) {
	if len(m) == 0 {
		return []byte("{}"), nil
	}
	var buf bytes.Buffer
	orderedKeys := orderConfigKeys(m)
	buf.WriteString("{\n")
	for idx, key := range orderedKeys {
		val := m[key]
		keyBarr, err := json.Marshal(key)
		if err != nil {
			return nil, err
		}
		valBarr, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			return nil, err
		}
		valBarr = reindentJson(valBarr, "  ")
		buf.WriteString("  ")
		buf.Write(keyBarr)
		buf.WriteString(": ")
		buf.Write(valBarr)
		if idx < len(orderedKeys)-1 {
			buf.WriteString(",")
		}
		buf.WriteString("\n")
	}
	buf.WriteString("}")
	return buf.Bytes(), nil
}

func SetBaseConfigValue(toMerge waveobj.MetaMapType) error {
	m, cerrs := ReadWaveHomeConfigFile(SettingsFile)
	if len(cerrs) > 0 {
		return fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	if m == nil {
		m = make(waveobj.MetaMapType)
	}
	for configKey, val := range toMerge {
		ctype := getConfigKeyType(configKey)
		if ctype == nil {
			return fmt.Errorf("invalid config key: %s", configKey)
		}
		if val == nil {
			delete(m, configKey)
		} else {
			if reflect.TypeOf(val) != ctype {
				return fmt.Errorf("invalid value type for %s: %T", configKey, val)
			}
			m[configKey] = val
		}
	}
	return WriteWaveHomeConfigFile(SettingsFile, m)
}

type WidgetConfigType struct {
	DisplayOrder float64          `json:"display:order,omitempty"`
	Icon         string           `json:"icon,omitempty"`
	Color        string           `json:"color,omitempty"`
	Label        string           `json:"label,omitempty"`
	Description  string           `json:"description,omitempty"`
	BlockDef     waveobj.BlockDef `json:"blockdef"`
}

type MimeTypeConfigType struct {
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

type TermThemeType struct {
	DisplayName         string  `json:"display:name"`
	DisplayOrder        float64 `json:"display:order"`
	Black               string  `json:"black"`
	Red                 string  `json:"red"`
	Green               string  `json:"green"`
	Yellow              string  `json:"yellow"`
	Blue                string  `json:"blue"`
	Magenta             string  `json:"magenta"`
	Cyan                string  `json:"cyan"`
	White               string  `json:"white"`
	BrightBlack         string  `json:"brightBlack"`
	BrightRed           string  `json:"brightRed"`
	BrightGreen         string  `json:"brightGreen"`
	BrightYellow        string  `json:"brightYellow"`
	BrightBlue          string  `json:"brightBlue"`
	BrightMagenta       string  `json:"brightMagenta"`
	BrightCyan          string  `json:"brightCyan"`
	BrightWhite         string  `json:"brightWhite"`
	Gray                string  `json:"gray"`
	CmdText             string  `json:"cmdtext"`
	Foreground          string  `json:"foreground"`
	SelectionBackground string  `json:"selectionBackground"`
	Background          string  `json:"background"`
	CursorAccent        string  `json:"cursorAccent"`
}
