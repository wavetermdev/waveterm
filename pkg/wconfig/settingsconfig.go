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

type DateTimeConfigType struct {
	Locale string                   `json:"locale"`
	Format DateTimeFormatConfigType `json:"format"`
}

type DateTimeFormatConfigType struct {
	DateStyle DateTimeStyle `json:"dateStyle"`
	TimeStyle DateTimeStyle `json:"timeStyle"`
	//TimeZone  string `json:"timeZone"` TODO: need a universal way to obtain this before adding it
}

type MimeTypeConfigType struct {
	Icon string `json:"icon"`
}

type BlockHeaderOpts struct {
	ShowBlockIds bool `json:"showblockids"`
}

type SettingsConfigType struct {
	MimeTypes   map[string]MimeTypeConfigType `json:"mimetypes"`
	DateTime    DateTimeConfigType            `json:"datetime"`
	Term        TerminalConfigType            `json:"term"`
	Widgets     []WidgetsConfigType           `json:"widgets"`
	BlockHeader BlockHeaderOpts               `json:"blockheader"`
}

func getSettingsConfigDefaults() SettingsConfigType {
	return SettingsConfigType{
		DateTime: DateTimeConfigType{
			Locale: wavebase.DetermineLocale(),
			Format: DateTimeFormatConfigType{
				DateStyle: DateTimeStyleMedium,
				TimeStyle: DateTimeStyleMedium,
			},
		},
		MimeTypes: map[string]MimeTypeConfigType{
			"audio":            {Icon: "file-audio"},
			"application/pdf":  {Icon: "file-pdf"},
			"application/json": {Icon: "file-lines"},
			"directory":        {Icon: "folder"},
			"font":             {Icon: "book-font"},
			"image":            {Icon: "file-image"},
			"text":             {Icon: "file-lines"},
			"text/css":         {Icon: "css3-alt fa-brands"},
			"text/javascript":  {Icon: "js fa-brands"},
			"text/typescript":  {Icon: "js fa-brands"},
			"text/golang":      {Icon: "go fa-brands"},
			"text/html":        {Icon: "html5 fa-brands"},
			"text/less":        {Icon: "less fa-brands"},
			"text/markdown":    {Icon: "markdown fa-brands"},
			"text/rust":        {Icon: "rust fa-brands"},
			"text/scss":        {Icon: "sass fa-brands"},
			"video":            {Icon: "file-video"},
		},
		Widgets: []WidgetsConfigType{
			{
				Icon: "files",
				BlockDef: wstore.BlockDef{
					View: "preview",
					Meta: map[string]any{"file": wavebase.GetHomeDir()},
				},
			},
			{
				Icon: "chart-simple",
				BlockDef: wstore.BlockDef{
					View: "plot",
				},
			},
		},
	}
}
