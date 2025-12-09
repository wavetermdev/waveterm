// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetrydata

import (
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

var ValidEventNames = map[string]bool{
	"app:startup":  true,
	"app:shutdown": true,
	"app:activity": true,
	"app:display":  true,
	"app:counts":   true,

	"action:magnify":     true,
	"action:settabtheme": true,
	"action:runaicmd":    true,
	"action:createtab":   true,
	"action:createblock": true,
	"action:openwaveai":  true,
	"action:other":       true,

	"wsh:run": true,

	"debug:panic": true,

	"conn:connect":      true,
	"conn:connecterror": true,

	"waveai:enabletelemetry": true,
	"waveai:post":            true,
	"waveai:feedback":        true,
	"waveai:showdiff":        true,
	"waveai:revertfile":      true,

	"onboarding:start":      true,
	"onboarding:skip":       true,
	"onboarding:fire":       true,
	"onboarding:githubstar": true,
}

type TEvent struct {
	Uuid    string      `json:"uuid,omitempty" db:"uuid"`
	Ts      int64       `json:"ts,omitempty" db:"ts"`
	TsLocal string      `json:"tslocal,omitempty" db:"tslocal"` // iso8601 format (wall clock converted to PT)
	Event   string      `json:"event" db:"event"`
	Props   TEventProps `json:"props" db:"-"` // Don't scan directly to map

	// DB fields
	Uploaded bool `json:"-" db:"uploaded"`

	// For database scanning
	RawProps string `json:"-" db:"props"`
}

type TEventUserProps struct {
	ClientArch           string `json:"client:arch,omitempty"`
	ClientVersion        string `json:"client:version,omitempty"`
	ClientInitialVersion string `json:"client:initial_version,omitempty"`
	ClientBuildTime      string `json:"client:buildtime,omitempty"`
	ClientOSRelease      string `json:"client:osrelease,omitempty"`
	ClientIsDev          bool   `json:"client:isdev,omitempty"`

	CohortMonth   string `json:"cohort:month,omitempty"`
	CohortISOWeek string `json:"cohort:isoweek,omitempty"`

	AutoUpdateChannel string `json:"autoupdate:channel,omitempty"`
	AutoUpdateEnabled bool   `json:"autoupdate:enabled,omitempty"`

	LocalShellType    string `json:"localshell:type,omitempty"`
	LocalShellVersion string `json:"localshell:version,omitempty"`

	LocCountryCode string `json:"loc:countrycode,omitempty"`
	LocRegionCode  string `json:"loc:regioncode,omitempty"`

	SettingsCustomWidgets   int `json:"settings:customwidgets,omitempty"`
	SettingsCustomAIPresets int `json:"settings:customaipresets,omitempty"`
	SettingsCustomSettings  int `json:"settings:customsettings,omitempty"`
	SettingsCustomAIModes   int `json:"settings:customaimodes,omitempty"`
	SettingsSecretsCount    int `json:"settings:secretscount,omitempty"`
}

type TEventProps struct {
	TEventUserProps `tstype:"-"` // generally don't need to set these since they will be automatically copied over

	ActiveMinutes       int `json:"activity:activeminutes,omitempty"`
	FgMinutes           int `json:"activity:fgminutes,omitempty"`
	OpenMinutes         int `json:"activity:openminutes,omitempty"`
	WaveAIActiveMinutes int `json:"activity:waveaiactiveminutes,omitempty"`
	WaveAIFgMinutes     int `json:"activity:waveaifgminutes,omitempty"`
	TermCommandsRun     int `json:"activity:termcommandsrun,omitempty"`

	AppFirstDay    bool `json:"app:firstday,omitempty"`
	AppFirstLaunch bool `json:"app:firstlaunch,omitempty"`

	ActionInitiator string `json:"action:initiator,omitempty" tstype:"\"keyboard\" | \"mouse\""`
	ActionType      string `json:"action:type,omitempty"`
	PanicType       string `json:"debug:panictype,omitempty"`
	BlockView       string `json:"block:view,omitempty"`
	AiBackendType   string `json:"ai:backendtype,omitempty"`
	AiLocal         bool   `json:"ai:local,omitempty"`
	WshCmd          string `json:"wsh:cmd,omitempty"`
	WshHadError     bool   `json:"wsh:haderror,omitempty"`
	ConnType        string `json:"conn:conntype,omitempty"`

	OnboardingFeature    string `json:"onboarding:feature,omitempty" tstype:"\"waveai\" | \"magnify\" | \"wsh\""`
	OnboardingVersion    string `json:"onboarding:version,omitempty"`
	OnboardingGithubStar string `json:"onboarding:githubstar,omitempty" tstype:"\"already\" | \"star\" | \"later\""`

	DisplayHeight int         `json:"display:height,omitempty"`
	DisplayWidth  int         `json:"display:width,omitempty"`
	DisplayDPR    float64     `json:"display:dpr,omitempty"`
	DisplayCount  int         `json:"display:count,omitempty"`
	DisplayAll    interface{} `json:"display:all,omitempty"`

	CountBlocks     int            `json:"count:blocks,omitempty"`
	CountTabs       int            `json:"count:tabs,omitempty"`
	CountWindows    int            `json:"count:windows,omitempty"`
	CountWorkspaces int            `json:"count:workspaces,omitempty"`
	CountSSHConn    int            `json:"count:sshconn,omitempty"`
	CountWSLConn    int            `json:"count:wslconn,omitempty"`
	CountViews      map[string]int `json:"count:views,omitempty"`

	WaveAIAPIType              string         `json:"waveai:apitype,omitempty"`
	WaveAIModel                string         `json:"waveai:model,omitempty"`
	WaveAIChatId               string         `json:"waveai:chatid,omitempty"`
	WaveAIStepNum              int            `json:"waveai:stepnum,omitempty"`
	WaveAIInputTokens          int            `json:"waveai:inputtokens,omitempty"`
	WaveAIOutputTokens         int            `json:"waveai:outputtokens,omitempty"`
	WaveAINativeWebSearchCount int            `json:"waveai:nativewebsearchcount,omitempty"`
	WaveAIRequestCount         int            `json:"waveai:requestcount,omitempty"`
	WaveAIToolUseCount         int            `json:"waveai:toolusecount,omitempty"`
	WaveAIToolUseErrorCount    int            `json:"waveai:tooluseerrorcount,omitempty"`
	WaveAIToolDetail           map[string]int `json:"waveai:tooldetail,omitempty"`
	WaveAIPremiumReq           int            `json:"waveai:premiumreq,omitempty"`
	WaveAIProxyReq             int            `json:"waveai:proxyreq,omitempty"`
	WaveAIHadError             bool           `json:"waveai:haderror,omitempty"`
	WaveAIImageCount           int            `json:"waveai:imagecount,omitempty"`
	WaveAIPDFCount             int            `json:"waveai:pdfcount,omitempty"`
	WaveAITextDocCount         int            `json:"waveai:textdoccount,omitempty"`
	WaveAITextLen              int            `json:"waveai:textlen,omitempty"`
	WaveAIFirstByteMs          int            `json:"waveai:firstbytems,omitempty"`  // ms
	WaveAIRequestDurMs         int            `json:"waveai:requestdurms,omitempty"` // ms
	WaveAIWidgetAccess         bool           `json:"waveai:widgetaccess,omitempty"`
	WaveAIThinkingLevel        string         `json:"waveai:thinkinglevel,omitempty"`
	WaveAIMode                 string         `json:"waveai:mode,omitempty"`
	WaveAIProvider             string         `json:"waveai:provider,omitempty"`
	WaveAIIsLocal              bool           `json:"waveai:islocal,omitempty"`
	WaveAIFeedback             string         `json:"waveai:feedback,omitempty" tstype:"\"good\" | \"bad\""`
	WaveAIAction               string         `json:"waveai:action,omitempty"`

	UserSet     *TEventUserProps `json:"$set,omitempty"`
	UserSetOnce *TEventUserProps `json:"$set_once,omitempty"`
}

func MakeTEvent(event string, props TEventProps) *TEvent {
	now := time.Now()
	// TsLocal gets set in EnsureTimestamps()
	return &TEvent{
		Uuid:  uuid.New().String(),
		Ts:    now.UnixMilli(),
		Event: event,
		Props: props,
	}
}

func MakeUntypedTEvent(event string, propsMap map[string]any) (*TEvent, error) {
	if event == "" {
		return nil, fmt.Errorf("event name must be non-empty")
	}
	var props TEventProps
	err := utilfn.ReUnmarshal(&props, propsMap)
	if err != nil {
		return nil, fmt.Errorf("error re-marshalling TEvent props: %w", err)
	}
	return MakeTEvent(event, props), nil
}

func (t *TEvent) EnsureTimestamps() {
	if t.Ts == 0 {
		t.Ts = time.Now().UnixMilli()
	}
	gtime := time.UnixMilli(t.Ts)
	t.TsLocal = utilfn.ConvertToWallClockPT(gtime).Format(time.RFC3339)
}

func (t *TEvent) UserSetProps() *TEventUserProps {
	if t.Props.UserSet == nil {
		t.Props.UserSet = &TEventUserProps{}
	}
	return t.Props.UserSet
}

func (t *TEvent) UserSetOnceProps() *TEventUserProps {
	if t.Props.UserSetOnce == nil {
		t.Props.UserSetOnce = &TEventUserProps{}
	}
	return t.Props.UserSetOnce
}

func (t *TEvent) ConvertRawJSON() error {
	if t.RawProps != "" {
		return json.Unmarshal([]byte(t.RawProps), &t.Props)
	}
	return nil
}

var eventNameRe = regexp.MustCompile(`^[a-zA-Z0-9.:_/-]+$`)

// validates a tevent that was just created (not for validating out of the DB, or an uploaded TEvent)
// checks that TS is pretty current (or unset)
func (te *TEvent) Validate(current bool) error {
	if te == nil {
		return fmt.Errorf("TEvent cannot be nil")
	}
	if te.Event == "" {
		return fmt.Errorf("TEvent.Event cannot be empty")
	}
	if !eventNameRe.MatchString(te.Event) {
		return fmt.Errorf("TEvent.Event invalid: %q", te.Event)
	}
	if !ValidEventNames[te.Event] {
		return fmt.Errorf("TEvent.Event not valid: %q", te.Event)
	}
	if te.Uuid == "" {
		return fmt.Errorf("TEvent.Uuid cannot be empty")
	}
	_, err := uuid.Parse(te.Uuid)
	if err != nil {
		return fmt.Errorf("TEvent.Uuid invalid: %v", err)
	}
	if current {
		if te.Ts != 0 {
			now := time.Now().UnixMilli()
			if te.Ts > now+60000 || te.Ts < now-60000 {
				return fmt.Errorf("TEvent.Ts is not current: %d", te.Ts)
			}
		}
	} else {
		if te.Ts == 0 {
			return fmt.Errorf("TEvent.Ts must be set")
		}
		if te.TsLocal == "" {
			return fmt.Errorf("TEvent.TsLocal must be set")
		}
		t, err := time.Parse(time.RFC3339, te.TsLocal)
		if err != nil {
			return fmt.Errorf("TEvent.TsLocal parse error: %v", err)
		}
		now := time.Now()
		if t.Before(now.Add(-30*24*time.Hour)) || t.After(now.Add(2*24*time.Hour)) {
			return fmt.Errorf("tslocal out of valid range")
		}
	}
	barr, err := json.Marshal(te.Props)
	if err != nil {
		return fmt.Errorf("TEvent.Props JSON error: %v", err)
	}
	if len(barr) > 20000 {
		return fmt.Errorf("TEvent.Props too large: %d", len(barr))
	}
	return nil
}
