// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

type TEvent struct {
	Ts      int64          `json:"ts" db:"ts"`
	TsLocal string         `json:"tslocal" db:"-"` // iso8601 format (wall clock converted to PT)
	Event   string         `json:"event" db:"event"`
	Props   map[string]any `json:"props" db:"-"` // Don't scan directly to map

	// DB fields
	Id       int64 `json:"-" db:"id"`
	Uploaded bool  `json:"-" db:"uploaded"`

	// For database scanning
	RawProps string `json:"-" db:"props"`
}

var phNestedProps = []string{"$set", "$set_once", "$add", "$unset"}
var eventNameRe = regexp.MustCompile(`^[a-zA-Z0-9.:_/-]+$`)
var propNameRe = regexp.MustCompile(`^[a-zA-Z0-9.:_/$-]+$`)

// validates a tevent that was just created (not for validating out of the DB, or an uploaded TEvent)
// checks that TS is pretty current (or unset)
func (te *TEvent) ValidateCurrentTEvent() error {
	if te == nil {
		return fmt.Errorf("TEvent cannot be nil")
	}
	if te.Event == "" {
		return fmt.Errorf("TEvent.Event cannot be empty")
	}
	if !eventNameRe.MatchString(te.Event) {
		return fmt.Errorf("TEvent.Event invalid: %q", te.Event)
	}
	if te.Ts != 0 {
		now := time.Now().UnixMilli()
		if te.Ts > now+60000 || te.Ts < now-60000 {
			return fmt.Errorf("TEvent.Ts is not current: %d", te.Ts)
		}
	}
	err := validatePropNames(te.Props, true)
	if err != nil {
		return fmt.Errorf("TEvent.Props: %v", err)
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

func validatePropNames(props map[string]any, topLevel bool) error {
	if props == nil {
		return nil
	}
	for k := range props {
		if !propNameRe.MatchString(k) {
			return fmt.Errorf("TEvent.Props key invalid: %q", k)
		}
	}
	if !topLevel {
		return nil
	}
	for _, k := range phNestedProps {
		nestedMap := utilfn.ConvertMap(props[k])
		err := validatePropNames(nestedMap, false)
		if err != nil {
			return fmt.Errorf("%v in nestedMap %s", err, k)
		}
	}
	return nil
}

func MakeTEvent(event string, props map[string]any) *TEvent {
	if event == "" {
		panic("TEvent.Event cannot be empty")
	}
	if props == nil {
		props = make(map[string]any)
	}
	now := time.Now()
	localTime := utilfn.ConvertToWallClockPT(now)
	return &TEvent{
		Ts:      now.UnixMilli(),
		TsLocal: localTime.Format(time.RFC3339),
		Event:   event,
		Props:   props,
	}
}

func (t *TEvent) EnsureTimestamps() {
	if t.Ts == 0 {
		t.Ts = time.Now().UnixMilli()
	}
	gtime := time.UnixMilli(t.Ts)
	t.TsLocal = utilfn.ConvertToWallClockPT(gtime).Format(time.RFC3339)
}

func (t *TEvent) SetUser(key string, value any) {
	if t.Props == nil {
		t.Props = make(map[string]any)
	}
	if t.Props["$set"] == nil {
		t.Props["$set"] = make(map[string]any)
	}
	t.Props["$set"].(map[string]any)[key] = value
}

func (t *TEvent) SetUserOnce(key string, value any) {
	if t.Props == nil {
		t.Props = make(map[string]any)
	}
	if t.Props["$set_once"] == nil {
		t.Props["$set_once"] = make(map[string]any)
	}
	t.Props["$set_once"].(map[string]any)[key] = value
}

func (t *TEvent) Set(key string, value any) {
	if t.Props == nil {
		t.Props = make(map[string]any)
	}
	t.Props[key] = value
}

func (t *TEvent) ConvertRawJSON() error {
	if t.RawProps != "" {
		return json.Unmarshal([]byte(t.RawProps), &t.Props)
	}
	return nil
}
