// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"os/user"
	"path/filepath"

	"github.com/wavetermdev/thenextwave/pkg/waveobj"
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

type AiConfigType struct {
	BaseURL   string `json:"baseurl"`
	ApiToken  string `json:"apitoken"`
	Name      string `json:"name"`
	Model     string `json:"model"`
	MaxTokens uint32 `json:"maxtokens"`
	TimeoutMs uint32 `json:"timeoutms"`
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
	Ai             *AiConfigType                 `json:"ai"`
	Widgets        []WidgetsConfigType           `json:"widgets"`
	BlockHeader    BlockHeaderOpts               `json:"blockheader"`
	AutoUpdate     *AutoUpdateOpts               `json:"autoupdate"`
	TermThemes     TermThemesConfigType          `json:"termthemes"`
	WindowSettings WindowSettingsType            `json:"window"`

	DefaultMeta *waveobj.MetaMapType            `json:"defaultmeta,omitempty"`
	Presets     map[string]*waveobj.MetaMapType `json:"presets,omitempty"`
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
	Background:          "#00000077",
	CursorAccent:        "",
}

var DraculaTheme = TermThemeType{
	Black:               "#21222C", // AnsiBlack
	Red:                 "#FF5555", // AnsiRed
	Green:               "#50FA7B", // AnsiGreen
	Yellow:              "#F1FA8C", // AnsiYellow
	Blue:                "#BD93F9", // AnsiBlue
	Magenta:             "#FF79C6", // AnsiMagenta
	Cyan:                "#8BE9FD", // AnsiCyan
	White:               "#F8F8F2", // AnsiWhite
	BrightBlack:         "#6272A4", // AnsiBrightBlack
	BrightRed:           "#FF6E6E", // AnsiBrightRed
	BrightGreen:         "#69FF94", // AnsiBrightGreen
	BrightYellow:        "#FFFFA5", // AnsiBrightYellow
	BrightBlue:          "#D6ACFF", // AnsiBrightBlue
	BrightMagenta:       "#FF92DF", // AnsiBrightMagenta
	BrightCyan:          "#A4FFFF", // AnsiBrightCyan
	BrightWhite:         "#FFFFFF", // AnsiBrightWhite
	Gray:                "#6272A4", // Comment or closest approximation
	CmdText:             "#F8F8F2", // Foreground
	Foreground:          "#F8F8F2", // Foreground
	SelectionBackground: "#44475a", // Selection
	Background:          "#282a36", // Background
	CursorAccent:        "#f8f8f2", // Foreground (used for cursor accent)
}

var CampbellTheme = TermThemeType{
	Black:               "#0C0C0C", // Black
	Red:                 "#C50F1F", // Red
	Green:               "#13A10E", // Green
	Yellow:              "#C19C00", // Yellow
	Blue:                "#0037DA", // Blue
	Magenta:             "#881798", // Purple (used as Magenta)
	Cyan:                "#3A96DD", // Cyan
	White:               "#CCCCCC", // White
	BrightBlack:         "#767676", // BrightBlack
	BrightRed:           "#E74856", // BrightRed
	BrightGreen:         "#16C60C", // BrightGreen
	BrightYellow:        "#F9F1A5", // BrightYellow
	BrightBlue:          "#3B78FF", // BrightBlue
	BrightMagenta:       "#B4009E", // BrightPurple (used as BrightMagenta)
	BrightCyan:          "#61D6D6", // BrightCyan
	BrightWhite:         "#F2F2F2", // BrightWhite
	Gray:                "#767676", // BrightBlack or closest approximation
	CmdText:             "#CCCCCC", // Foreground
	Foreground:          "#CCCCCC", // Foreground
	SelectionBackground: "#3A96DD", // Cyan (chosen for selection background)
	Background:          "#0C0C0C", // Background
	CursorAccent:        "#CCCCCC", // Foreground (used for cursor accent)
}

var BgDefaultPreset = waveobj.MetaMapType{
	wstore.MetaKey_DisplayName:  "Default",
	wstore.MetaKey_DisplayOrder: -1,
	wstore.MetaKey_BgClear:      true,
}

var BgRainbowPreset = waveobj.MetaMapType{
	wstore.MetaKey_DisplayName:  "Rainbow",
	wstore.MetaKey_DisplayOrder: 1,
	wstore.MetaKey_BgClear:      true,
	wstore.MetaKey_Bg:           "linear-gradient( 226.4deg,  rgba(255,26,1,1) 28.9%, rgba(254,155,1,1) 33%, rgba(255,241,0,1) 48.6%, rgba(34,218,1,1) 65.3%, rgba(0,141,254,1) 80.6%, rgba(113,63,254,1) 100.1% );",
	wstore.MetaKey_BgOpacity:    0.3,
}

var BgGreenPreset = waveobj.MetaMapType{
	wstore.MetaKey_DisplayName: "Green",
	wstore.MetaKey_BgClear:     true,
	wstore.MetaKey_Bg:          "green",
	wstore.MetaKey_BgOpacity:   0.3,
}

var BgBluePreset = waveobj.MetaMapType{
	wstore.MetaKey_DisplayName: "Blue",
	wstore.MetaKey_BgClear:     true,
	wstore.MetaKey_Bg:          "blue",
	wstore.MetaKey_BgOpacity:   0.3,
}

var BgRedPreset = waveobj.MetaMapType{
	wstore.MetaKey_DisplayName: "Red",
	wstore.MetaKey_BgClear:     true,
	wstore.MetaKey_Bg:          "red",
	wstore.MetaKey_BgOpacity:   0.3,
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
	if settings.Ai == nil {
		settings.Ai = &AiConfigType{
			Name:      userName,
			Model:     "gpt-3.5-turbo",
			MaxTokens: 1000,
			TimeoutMs: 10 * 1000,
		}
	}
	defaultWidgets := []WidgetsConfigType{
		{
			Icon:  "globe",
			Label: "web",
			BlockDef: wstore.BlockDef{
				Meta: map[string]any{
					wstore.MetaKey_View: "web",
					wstore.MetaKey_Url:  "https://waveterm.dev/",
				},
			},
		},
		{
			Icon:  "sparkles",
			Label: "waveai",
			BlockDef: wstore.BlockDef{
				Meta: map[string]any{
					wstore.MetaKey_View: "waveai",
				},
			},
		},
		{
			Icon:  "chart-line",
			Label: "cpu",
			BlockDef: wstore.BlockDef{
				Meta: map[string]any{
					wstore.MetaKey_View: "cpuplot",
				},
			},
		},
		{
			Icon:  "circle-question",
			Label: "help",
			BlockDef: wstore.BlockDef{
				Meta: map[string]any{
					wstore.MetaKey_View: "help",
				},
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
	if _, found := settings.TermThemes["dracula"]; !found {
		settings.TermThemes["dracula"] = DraculaTheme
	}
	if _, found := settings.TermThemes["campbell"]; !found {
		settings.TermThemes["campbell"] = CampbellTheme
	}
	if settings.Presets == nil {
		settings.Presets = make(map[string]*waveobj.MetaMapType)
	}
	if _, found := settings.Presets["bg@default"]; !found {
		settings.Presets["bg@default"] = &BgDefaultPreset
	}
	if _, found := settings.Presets["bg@rainbow"]; !found {
		settings.Presets["bg@rainbow"] = &BgRainbowPreset
	}
	if _, found := settings.Presets["bg@green"]; !found {
		settings.Presets["bg@green"] = &BgGreenPreset
	}
	if _, found := settings.Presets["bg@blue"]; !found {
		settings.Presets["bg@blue"] = &BgBluePreset
	}
	if _, found := settings.Presets["bg@red"]; !found {
		settings.Presets["bg@red"] = &BgRedPreset
	}
}
