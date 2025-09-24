// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"strings"
)

const Entity_Any = "any"

// for typescript typing
type MetaTSType struct {
	// shared
	View           string   `json:"view,omitempty"`
	Controller     string   `json:"controller,omitempty"`
	File           string   `json:"file,omitempty"`
	Url            string   `json:"url,omitempty"`
	PinnedUrl      string   `json:"pinnedurl,omitempty"`
	Connection     string   `json:"connection,omitempty"`
	Edit           bool     `json:"edit,omitempty"`
	History        []string `json:"history,omitempty"`
	HistoryForward []string `json:"history:forward,omitempty"`

	DisplayName  string  `json:"display:name,omitempty"`
	DisplayOrder float64 `json:"display:order,omitempty"`

	Icon      string `json:"icon,omitempty"`
	IconColor string `json:"icon:color,omitempty"`

	FrameClear             bool   `json:"frame:*,omitempty"`
	Frame                  bool   `json:"frame,omitempty"`
	FrameBorderColor       string `json:"frame:bordercolor,omitempty"`
	FrameActiveBorderColor string `json:"frame:activebordercolor,omitempty"`
	FrameTitle             string `json:"frame:title,omitempty"`
	FrameIcon              string `json:"frame:icon,omitempty"`
	FrameText              string `json:"frame:text,omitempty"`

	CmdClear            bool     `json:"cmd:*,omitempty"`
	Cmd                 string   `json:"cmd,omitempty"`
	CmdInteractive      bool     `json:"cmd:interactive,omitempty"`
	CmdLogin            bool     `json:"cmd:login,omitempty"`
	CmdRunOnStart       bool     `json:"cmd:runonstart,omitempty"`
	CmdClearOnStart     bool     `json:"cmd:clearonstart,omitempty"`
	CmdRunOnce          bool     `json:"cmd:runonce,omitempty"`
	CmdCloseOnExit      bool     `json:"cmd:closeonexit,omitempty"`
	CmdCloseOnExitForce bool     `json:"cmd:closeonexitforce,omitempty"`
	CmdCloseOnExitDelay float64  `json:"cmd:closeonexitdelay,omitempty"`
	CmdNoWsh            bool     `json:"cmd:nowsh,omitempty"`
	CmdArgs             []string `json:"cmd:args,omitempty"`  // args for cmd (only if cmd:shell is false)
	CmdShell            bool     `json:"cmd:shell,omitempty"` // shell expansion for cmd+args (defaults to true)
	CmdAllowConnChange  bool     `json:"cmd:allowconnchange,omitempty"`
	CmdJwt              bool     `json:"cmd:jwt,omitempty"` // force adding JWT to environment

	// these can be nested under "[conn]"
	CmdEnv            map[string]string `json:"cmd:env,omitempty"`
	CmdCwd            string            `json:"cmd:cwd,omitempty"`
	CmdInitScript     string            `json:"cmd:initscript,omitempty"`
	CmdInitScriptSh   string            `json:"cmd:initscript.sh,omitempty"`
	CmdInitScriptBash string            `json:"cmd:initscript.bash,omitempty"`
	CmdInitScriptZsh  string            `json:"cmd:initscript.zsh,omitempty"`
	CmdInitScriptPwsh string            `json:"cmd:initscript.pwsh,omitempty"`
	CmdInitScriptFish string            `json:"cmd:initscript.fish,omitempty"`

	// AI options match settings
	AiClear      bool    `json:"ai:*,omitempty"`
	AiPresetKey  string  `json:"ai:preset,omitempty"`
	AiApiType    string  `json:"ai:apitype,omitempty"`
	AiBaseURL    string  `json:"ai:baseurl,omitempty"`
	AiApiToken   string  `json:"ai:apitoken,omitempty"`
	AiName       string  `json:"ai:name,omitempty"`
	AiModel      string  `json:"ai:model,omitempty"`
	AiOrgID      string  `json:"ai:orgid,omitempty"`
	AIApiVersion string  `json:"ai:apiversion,omitempty"`
	AiMaxTokens  float64 `json:"ai:maxtokens,omitempty"`
	AiTimeoutMs  float64 `json:"ai:timeoutms,omitempty"`

	EditorClear               bool    `json:"editor:*,omitempty"`
	EditorMinimapEnabled      bool    `json:"editor:minimapenabled,omitempty"`
	EditorStickyScrollEnabled bool    `json:"editor:stickyscrollenabled,omitempty"`
	EditorWordWrap            bool    `json:"editor:wordwrap,omitempty"`
	EditorFontSize            float64 `json:"editor:fontsize,omitempty"`

	GraphClear     bool     `json:"graph:*,omitempty"`
	GraphNumPoints int      `json:"graph:numpoints,omitempty"`
	GraphMetrics   []string `json:"graph:metrics,omitempty"`

	SysinfoType string `json:"sysinfo:type,omitempty"`

	// for tabs
	BgClear             bool    `json:"bg:*,omitempty"`
	Bg                  string  `json:"bg,omitempty"`
	BgOpacity           float64 `json:"bg:opacity,omitempty"`
	BgBlendMode         string  `json:"bg:blendmode,omitempty"`
	BgBorderColor       string  `json:"bg:bordercolor,omitempty"`       // frame:bordercolor
	BgActiveBorderColor string  `json:"bg:activebordercolor,omitempty"` // frame:activebordercolor

	// for tabs
	WaveAiPanelOpen  bool `json:"waveai:panelopen,omitempty"`
	WaveAiPanelWidth int  `json:"waveai:panelwidth,omitempty"`

	TermClear               bool     `json:"term:*,omitempty"`
	TermFontSize            int      `json:"term:fontsize,omitempty"`
	TermFontFamily          string   `json:"term:fontfamily,omitempty"`
	TermMode                string   `json:"term:mode,omitempty"`
	TermTheme               string   `json:"term:theme,omitempty"`
	TermLocalShellPath      string   `json:"term:localshellpath,omitempty"` // matches settings
	TermLocalShellOpts      []string `json:"term:localshellopts,omitempty"` // matches settings
	TermScrollback          *int     `json:"term:scrollback,omitempty"`
	TermVDomSubBlockId      string   `json:"term:vdomblockid,omitempty"`
	TermVDomToolbarBlockId  string   `json:"term:vdomtoolbarblockid,omitempty"`
	TermTransparency        *float64 `json:"term:transparency,omitempty"` // default 0.5
	TermAllowBracketedPaste *bool    `json:"term:allowbracketedpaste,omitempty"`
	TermShiftEnterNewline   *bool    `json:"term:shiftenternewline,omitempty"`
	TermConnDebug           string   `json:"term:conndebug,omitempty"` // null, info, debug

	WebZoom      float64 `json:"web:zoom,omitempty"`
	WebHideNav   *bool   `json:"web:hidenav,omitempty"`
	WebPartition string  `json:"web:partition,omitempty"`

	MarkdownFontSize      float64 `json:"markdown:fontsize,omitempty"`
	MarkdownFixedFontSize float64 `json:"markdown:fixedfontsize,omitempty"`

	TsunamiClear          bool              `json:"tsunami:*,omitempty"`
	TsunamiSdkReplacePath string            `json:"tsunami:sdkreplacepath,omitempty"`
	TsunamiAppPath        string            `json:"tsunami:apppath,omitempty"`
	TsunamiScaffoldPath   string            `json:"tsunami:scaffoldpath,omitempty"`
	TsunamiEnv            map[string]string `json:"tsunami:env,omitempty"`

	VDomClear         bool   `json:"vdom:*,omitempty"`
	VDomInitialized   bool   `json:"vdom:initialized,omitempty"`
	VDomCorrelationId string `json:"vdom:correlationid,omitempty"`
	VDomRoute         string `json:"vdom:route,omitempty"`
	VDomPersist       bool   `json:"vdom:persist,omitempty"`

	Count int `json:"count,omitempty"` // temp for cpu plot. will remove later
}

type MetaDataDecl struct {
	Key        string   `json:"key"`
	Desc       string   `json:"desc,omitempty"`
	Type       string   `json:"type"` // string, int, float, bool, array, object
	Default    any      `json:"default,omitempty"`
	StrOptions []string `json:"stroptions,omitempty"`
	NumRange   []*int   `json:"numrange,omitempty"` // inclusive, null means no limit
	Entity     []string `json:"entity"`             // what entities this applies to, e.g. "block", "tab", "any", etc.
	Special    []string `json:"special,omitempty"`  // special handling.  things that need to happen if this gets updated
}

type MetaPresetDecl struct {
	Preset string   `json:"preset"`
	Desc   string   `json:"desc,omitempty"`
	Keys   []string `json:"keys"`
	Entity []string `json:"entity"` // what entities this applies to, e.g. "block", "tab", etc.
}

// returns a clean copy of meta with mergeMeta merged in
// if mergeSpecial is false, then special keys will not be merged (like display:*)
func MergeMeta(meta MetaMapType, metaUpdate MetaMapType, mergeSpecial bool) MetaMapType {
	rtn := make(MetaMapType)
	for k, v := range meta {
		rtn[k] = v
	}
	// deal with "section:*" keys
	for k := range metaUpdate {
		if !strings.HasSuffix(k, ":*") {
			continue
		}
		if !metaUpdate.GetBool(k, false) {
			continue
		}
		prefix := strings.TrimSuffix(k, ":*")
		if prefix == "" {
			continue
		}
		// delete "[prefix]" and all keys that start with "[prefix]:"
		prefixColon := prefix + ":"
		for k2 := range rtn {
			if k2 == prefix || strings.HasPrefix(k2, prefixColon) {
				delete(rtn, k2)
			}
		}
	}
	// now deal with regular keys
	for k, v := range metaUpdate {
		if !mergeSpecial && strings.HasPrefix(k, "display:") {
			continue
		}
		if strings.HasSuffix(k, ":*") {
			continue
		}
		if v == nil {
			delete(rtn, k)
			continue
		}
		rtn[k] = v
	}
	return rtn
}
