package wconfig

import (
	"path/filepath"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const settingsFile = "settings.json"

var settingsAbsPath = filepath.Join(configDirAbsPath, settingsFile)

type WidgetsConfigType struct {
	Icon        string          `json:"icon"`
	Color       string          `json:"color,omitempty"`
	Label       string          `json:"label,omitempty"`
	Description string          `json:"description,omitempty"`
	BlockDef    wstore.BlockDef `json:"blockdef"`
}

type TerminalConfigType struct {
	FontSize   int    `json:"fontsize,omitempty"`
	FontFamily string `json:"fontfamily,omitempty"`
}

type SettingsConfigType struct {
	Widgets []WidgetsConfigType `json:"widgets"`
	Term    TerminalConfigType  `json:"term"`
}

func getSettingsConfigDefaults() SettingsConfigType {
	return SettingsConfigType{
		Widgets: []WidgetsConfigType{
			{
				Icon: "fa fa-solid fa-files fa-fw",
				BlockDef: wstore.BlockDef{
					View: "preview",
					Meta: map[string]any{"file": wavebase.GetHomeDir()},
				},
			},
			{
				Icon: "fa fa-solid fa-chart-simple fa-fw",
				BlockDef: wstore.BlockDef{
					View: "plot",
				},
			},
		},
	}
}
