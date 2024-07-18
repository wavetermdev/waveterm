// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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

type MimeTypeConfigType struct {
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

type BlockHeaderOpts struct {
	ShowBlockIds bool `json:"showblockids"`
}

type AutoUpdateOpts struct {
	Enabled    bool   `json:"enabled"`
	IntervalMs uint32 `json:"intervalms"`
}

type SettingsConfigType struct {
	MimeTypes   map[string]MimeTypeConfigType `json:"mimetypes"`
	Term        TerminalConfigType            `json:"term"`
	Widgets     []WidgetsConfigType           `json:"widgets"`
	BlockHeader BlockHeaderOpts               `json:"blockheader"`
	AutoUpdate  AutoUpdateOpts                `json:"autoupdate"`
}

func getSettingsConfigDefaults() SettingsConfigType {
	return SettingsConfigType{
		MimeTypes: map[string]MimeTypeConfigType{
			"audio":            {Icon: "file-audio"},
			"application/pdf":  {Icon: "file-pdf"},
			"application/json": {Icon: "file-lines"},
			"directory":        {Icon: "folder", Color: "var(--term-bright-blue)"},
			"font":             {Icon: "book-font"},
			"image":            {Icon: "file-image"},
			"text":             {Icon: "file-lines"},
			"text/css":         {Icon: "css3-alt fa-brands"},
			"text/javascript":  {Icon: "js fa-brands"},
			"text/typescript":  {Icon: "js fa-brands"},
			"text/golang":      {Icon: "golang fa-brands"},
			"text/html":        {Icon: "html5 fa-brands"},
			"text/less":        {Icon: "less fa-brands"},
			"text/markdown":    {Icon: "markdown fa-brands"},
			"text/rust":        {Icon: "rust fa-brands"},
			"text/scss":        {Icon: "sass fa-brands"},
			"video":            {Icon: "file-video"},
			"text/csv":         {Icon: "file-csv"},
		},
		Widgets: []WidgetsConfigType{
			{
				Icon:  "files",
				Label: "files",
				BlockDef: wstore.BlockDef{
					View: "preview",
					Meta: map[string]any{"file": wavebase.GetHomeDir()},
				},
			},
			{
				Icon:  "chart-simple",
				Label: "chart",
				BlockDef: wstore.BlockDef{
					View: "plot",
				},
			},
			{
				Icon:  "globe",
				Label: "web",
				BlockDef: wstore.BlockDef{
					View: "web",
					Meta: map[string]any{"url": "https://waveterm.dev/"},
				},
			},
			{
				Icon:  "sparkles",
				Label: "waveai",
				BlockDef: wstore.BlockDef{
					View: "waveai",
				},
			},
		},
		AutoUpdate: AutoUpdateOpts{
			Enabled:    true,
			IntervalMs: 3600000,
		},
	}
}
