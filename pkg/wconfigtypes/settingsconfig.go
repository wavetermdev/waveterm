package wconfigtypes

import (
	"bytes"
	"encoding/json"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

type MetaSettingsType struct {
	waveobj.MetaMapType
}

func (m *MetaSettingsType) UnmarshalJSON(data []byte) error {
	var metaMap waveobj.MetaMapType
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&metaMap); err != nil {
		return err
	}
	*m = MetaSettingsType{MetaMapType: metaMap}
	return nil
}

func (m MetaSettingsType) MarshalJSON() ([]byte, error) {
	return json.Marshal(m.MetaMapType)
}

type SettingsType struct {
	AiClear      bool    `json:"ai:*,omitempty"`
	AiPreset     string  `json:"ai:preset,omitempty"`
	AiApiType    string  `json:"ai:apitype,omitempty"`
	AiBaseURL    string  `json:"ai:baseurl,omitempty"`
	AiApiToken   string  `json:"ai:apitoken,omitempty"`
	AiName       string  `json:"ai:name,omitempty"`
	AiModel      string  `json:"ai:model,omitempty"`
	AiOrgID      string  `json:"ai:orgid,omitempty"`
	AIApiVersion string  `json:"ai:apiversion,omitempty"`
	AiMaxTokens  float64 `json:"ai:maxtokens,omitempty"`
	AiTimeoutMs  float64 `json:"ai:timeoutms,omitempty"`

	TermClear          bool     `json:"term:*,omitempty"`
	TermFontSize       float64  `json:"term:fontsize,omitempty"`
	TermFontFamily     string   `json:"term:fontfamily,omitempty"`
	TermTheme          string   `json:"term:theme,omitempty"`
	TermDisableWebGl   bool     `json:"term:disablewebgl,omitempty"`
	TermLocalShellPath string   `json:"term:localshellpath,omitempty"`
	TermLocalShellOpts []string `json:"term:localshellopts,omitempty"`
	TermScrollback     *int64   `json:"term:scrollback,omitempty"`
	TermCopyOnSelect   *bool    `json:"term:copyonselect,omitempty"`

	EditorMinimapEnabled      bool `json:"editor:minimapenabled,omitempty"`
	EditorStickyScrollEnabled bool `json:"editor:stickyscrollenabled,omitempty"`

	WebClear               bool   `json:"web:*,omitempty"`
	WebOpenLinksInternally bool   `json:"web:openlinksinternally,omitempty"`
	WebDefaultUrl          string `json:"web:defaulturl,omitempty"`
	WebDefaultSearch       string `json:"web:defaultsearch,omitempty"`

	BlockHeaderClear        bool `json:"blockheader:*,omitempty"`
	BlockHeaderShowBlockIds bool `json:"blockheader:showblockids,omitempty"`

	AutoUpdateClear         bool    `json:"autoupdate:*,omitempty"`
	AutoUpdateEnabled       bool    `json:"autoupdate:enabled,omitempty"`
	AutoUpdateIntervalMs    float64 `json:"autoupdate:intervalms,omitempty"`
	AutoUpdateInstallOnQuit bool    `json:"autoupdate:installonquit,omitempty"`
	AutoUpdateChannel       string  `json:"autoupdate:channel,omitempty"`

	PreviewShowHiddenFiles *bool `json:"preview:showhiddenfiles,omitempty"`

	WidgetClear    bool `json:"widget:*,omitempty"`
	WidgetShowHelp bool `json:"widget:showhelp,omitempty"`

	WindowClear                       bool     `json:"window:*,omitempty"`
	WindowTransparent                 bool     `json:"window:transparent,omitempty"`
	WindowBlur                        bool     `json:"window:blur,omitempty"`
	WindowOpacity                     *float64 `json:"window:opacity,omitempty"`
	WindowBgColor                     string   `json:"window:bgcolor,omitempty"`
	WindowReducedMotion               bool     `json:"window:reducedmotion,omitempty"`
	WindowTileGapSize                 *int64   `json:"window:tilegapsize,omitempty"`
	WindowShowMenuBar                 bool     `json:"window:showmenubar,omitempty"`
	WindowNativeTitleBar              bool     `json:"window:nativetitlebar,omitempty"`
	WindowDisableHardwareAcceleration bool     `json:"window:disablehardwareacceleration,omitempty"`
	WindowMaxTabCacheSize             int      `json:"window:maxtabcachesize,omitempty"`

	TelemetryClear   bool `json:"telemetry:*,omitempty"`
	TelemetryEnabled bool `json:"telemetry:enabled,omitempty"`

	ConnClear               bool `json:"conn:*,omitempty"`
	ConnAskBeforeWshInstall bool `json:"conn:askbeforewshinstall,omitempty"`
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
	Cursor              string  `json:"cursor"`
}
