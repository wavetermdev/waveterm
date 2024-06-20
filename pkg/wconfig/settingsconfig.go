package wconfig

import (
	"path/filepath"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const settingsFile = "settings.json"

var settingsAbsPath = filepath.Join(configDirAbsPath, settingsFile)

type WidgetsConfigType struct {
	Icon     string          `json:"icon"`
	BlockDef wstore.BlockDef `json:"blockdef"`
}

type SettingsConfigType struct {
	Widgets []WidgetsConfigType `json:"widgets"`
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
