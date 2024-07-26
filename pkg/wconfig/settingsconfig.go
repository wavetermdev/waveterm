// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"os/user"
	"path/filepath"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const termThemesDir = "terminal-themes"
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

type TermThemeType struct {
	Black               string `json:"black"`
	Red                 string `json:"red"`
	Green               string `json:"green"`
	Yellow              string `json:"yellow"`
	Blue                string `json:"blue"`
	Magenta             string `json:"magenta"`
	Cyan                string `json:"cyan"`
	White               string `json:"white"`
	BrightBlack         string `json:"brightBlack"`
	BrightRed           string `json:"brightRed"`
	BrightGreen         string `json:"brightGreen"`
	BrightYellow        string `json:"brightYellow"`
	BrightBlue          string `json:"brightBlue"`
	BrightMagenta       string `json:"brightMagenta"`
	BrightCyan          string `json:"brightCyan"`
	BrightWhite         string `json:"brightWhite"`
	Gray                string `json:"gray"`
	CmdText             string `json:"cmdtext"`
	Foreground          string `json:"foreground"`
	SelectionBackground string `json:"selectionBackground"`
	Background          string `json:"background"`
	CursorAccent        string `json:"cursorAccent"`
}

type TermThemesConfigType map[string]TermThemeType

// TODO add default term theme settings

// note we pointers so we preserve nulls
type WindowSettingsType struct {
	Transparent *bool    `json:"transparent"`
	Blur        *bool    `json:"blur"`
	Opacity     *float64 `json:"opacity"`
	BgColor     *string  `json:"bgcolor"`
}

type SettingsConfigType struct {
	MimeTypes      map[string]MimeTypeConfigType `json:"mimetypes"`
	Term           TerminalConfigType            `json:"term"`
	Widgets        []WidgetsConfigType           `json:"widgets"`
	BlockHeader    BlockHeaderOpts               `json:"blockheader"`
	AutoUpdate     *AutoUpdateOpts               `json:"autoupdate"`
	TermThemes     TermThemesConfigType          `json:"termthemes"`
	WindowSettings WindowSettingsType            `json:"window"`
}

var DefaultTermDarkTheme = TermThemeType{
	Black:               "#757575",
	Red:                 "#cc685c",
	Green:               "#76c266",
	Yellow:              "#cbca9b",
	Blue:                "#85aacb",
	Magenta:             "#cc72ca",
	Cyan:                "#74a7cb",
	White:               "#c1c1c1",
	BrightBlack:         "#727272",
	BrightRed:           "#cc9d97",
	BrightGreen:         "#a3dd97",
	BrightYellow:        "#cbcaaa",
	BrightBlue:          "#9ab6cb",
	BrightMagenta:       "#cc8ecb",
	BrightCyan:          "#b7b8cb",
	BrightWhite:         "#f0f0f0",
	Gray:                "#8b918a",
	CmdText:             "#f0f0f0",
	Foreground:          "#c1c1c1",
	SelectionBackground: "",
	Background:          "#00000000",
	CursorAccent:        "",
}

func applyDefaultSettings(settings *SettingsConfigType) {
	defaultMimeTypes := map[string]MimeTypeConfigType{
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
	}
	if settings.MimeTypes == nil {
		settings.MimeTypes = defaultMimeTypes
	} else {
		for k, v := range defaultMimeTypes {
			if _, found := settings.MimeTypes[k]; !found {
				settings.MimeTypes[k] = v
			}
		}
	}
	if settings.AutoUpdate == nil {
		settings.AutoUpdate = &AutoUpdateOpts{
			Enabled:    true,
			IntervalMs: 3600000,
		}
	}
	var userName string
	currentUser, err := user.Current()
	if err != nil {
		userName = "user"
	} else {
		userName = currentUser.Username
	}
	defaultWidgets := []WidgetsConfigType{
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
				Meta: map[string]any{"name": userName, "baseurl": "", "apitoken": ""},
			},
		},
	}
	if settings.Widgets == nil {
		settings.Widgets = defaultWidgets
	}
	if settings.TermThemes == nil {
		settings.TermThemes = make(map[string]TermThemeType)
	}
	if _, found := settings.TermThemes["default-dark"]; !found {
		settings.TermThemes["default-dark"] = DefaultTermDarkTheme
	}
}
