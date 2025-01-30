// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetry

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/daystr"
	"github.com/wavetermdev/waveterm/pkg/util/dbutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const MaxTzNameLen = 50

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

func (t *TEvent) convertRawJSON() error {
	if t.RawProps != "" {
		return json.Unmarshal([]byte(t.RawProps), &t.Props)
	}
	return nil
}

type ActivityType struct {
	Day           string        `json:"day"`
	Uploaded      bool          `json:"-"`
	TData         TelemetryData `json:"tdata"`
	TzName        string        `json:"tzname"`
	TzOffset      int           `json:"tzoffset"`
	ClientVersion string        `json:"clientversion"`
	ClientArch    string        `json:"clientarch"`
	BuildTime     string        `json:"buildtime"`
	OSRelease     string        `json:"osrelease"`
}

type TelemetryData struct {
	ActiveMinutes int                          `json:"activeminutes"`
	FgMinutes     int                          `json:"fgminutes"`
	OpenMinutes   int                          `json:"openminutes"`
	NumTabs       int                          `json:"numtabs"`
	NumBlocks     int                          `json:"numblocks,omitempty"`
	NumWindows    int                          `json:"numwindows,omitempty"`
	NumWS         int                          `json:"numws,omitempty"`
	NumWSNamed    int                          `json:"numwsnamed,omitempty"`
	NumSSHConn    int                          `json:"numsshconn,omitempty"`
	NumWSLConn    int                          `json:"numwslconn,omitempty"`
	NumMagnify    int                          `json:"nummagnify,omitempty"`
	NewTab        int                          `json:"newtab"`
	NumStartup    int                          `json:"numstartup,omitempty"`
	NumShutdown   int                          `json:"numshutdown,omitempty"`
	NumPanics     int                          `json:"numpanics,omitempty"`
	NumAIReqs     int                          `json:"numaireqs,omitempty"`
	SetTabTheme   int                          `json:"settabtheme,omitempty"`
	Displays      []wshrpc.ActivityDisplayType `json:"displays,omitempty"`
	Renderers     map[string]int               `json:"renderers,omitempty"`
	Blocks        map[string]int               `json:"blocks,omitempty"`
	WshCmds       map[string]int               `json:"wshcmds,omitempty"`
	Conn          map[string]int               `json:"conn,omitempty"`
}

func (tdata TelemetryData) Value() (driver.Value, error) {
	return dbutil.QuickValueJson(tdata)
}

func (tdata *TelemetryData) Scan(val interface{}) error {
	return dbutil.QuickScanJson(tdata, val)
}

func IsTelemetryEnabled() bool {
	settings := wconfig.GetWatcher().GetFullConfig()
	return settings.Settings.TelemetryEnabled
}

func IsAutoUpdateEnabled() bool {
	settings := wconfig.GetWatcher().GetFullConfig()
	return settings.Settings.AutoUpdateEnabled
}

func AutoUpdateChannel() string {
	settings := wconfig.GetWatcher().GetFullConfig()
	return settings.Settings.AutoUpdateChannel
}

// Wraps UpdateCurrentActivity, spawns goroutine, and logs errors
func GoUpdateActivityWrap(update wshrpc.ActivityUpdate, debugStr string) {
	go func() {
		defer panichandler.PanicHandlerNoTelemetry("GoUpdateActivityWrap", recover())
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		err := UpdateActivity(ctx, update)
		if err != nil {
			// ignore error, just log, since this is not critical
			log.Printf("error updating current activity (%s): %v\n", debugStr, err)
		}
	}()
}

func InsertTEvent(ctx context.Context, event *TEvent) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		query := `INSERT INTO db_tevent (ts, event, props)
				  VALUES (?, ?, ?)`
		tx.Exec(query, event.Ts, event.Event, dbutil.QuickJson(event.Props))
		return nil
	})
}

func GetNonUploadedTEvents(ctx context.Context, maxEvents int) ([]*TEvent, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) ([]*TEvent, error) {
		var rtn []*TEvent
		query := `SELECT id, ts, event, props, uploaded FROM db_tevent WHERE uploaded = 0 ORDER BY ts LIMIT ?`
		tx.Select(&rtn, query, maxEvents)
		for _, event := range rtn {
			if err := event.convertRawJSON(); err != nil {
				return nil, fmt.Errorf("scan json for event %d: %w", event.Id, err)
			}
		}
		return rtn, nil
	})
}

func MarkTEventsAsUploaded(ctx context.Context, events []*TEvent) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ids := make([]int64, 0, len(events))
		for _, event := range events {
			ids = append(ids, event.Id)
		}
		query := `UPDATE db_tevent SET uploaded = 1 WHERE id IN (SELECT value FROM json_each(?))`
		tx.Exec(query, dbutil.QuickJson(ids))
		return nil
	})
}

func UpdateActivity(ctx context.Context, update wshrpc.ActivityUpdate) error {
	now := time.Now()
	dayStr := daystr.GetCurDayStr()
	txErr := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		var tdata TelemetryData
		query := `SELECT tdata FROM db_activity WHERE day = ?`
		found := tx.Get(&tdata, query, dayStr)
		if !found {
			query = `INSERT INTO db_activity (day, uploaded, tdata, tzname, tzoffset, clientversion, clientarch, buildtime, osrelease)
                                      VALUES (  ?,        0,     ?,      ?,        ?,             ?,          ?,         ?,         ?)`
			tzName, tzOffset := now.Zone()
			if len(tzName) > MaxTzNameLen {
				tzName = tzName[0:MaxTzNameLen]
			}
			tx.Exec(query, dayStr, tdata, tzName, tzOffset, wavebase.WaveVersion, wavebase.ClientArch(), wavebase.BuildTime, wavebase.UnameKernelRelease())
		}
		tdata.FgMinutes += update.FgMinutes
		tdata.ActiveMinutes += update.ActiveMinutes
		tdata.OpenMinutes += update.OpenMinutes
		tdata.NewTab += update.NewTab
		tdata.NumStartup += update.Startup
		tdata.NumShutdown += update.Shutdown
		tdata.SetTabTheme += update.SetTabTheme
		tdata.NumMagnify += update.NumMagnify
		tdata.NumPanics += update.NumPanics
		tdata.NumAIReqs += update.NumAIReqs
		if update.NumTabs > 0 {
			tdata.NumTabs = update.NumTabs
		}
		if update.NumBlocks > 0 {
			tdata.NumBlocks = update.NumBlocks
		}
		if update.NumWindows > 0 {
			tdata.NumWindows = update.NumWindows
		}
		if update.NumWS > 0 {
			tdata.NumWS = update.NumWS
		}
		if update.NumWSNamed > 0 {
			tdata.NumWSNamed = update.NumWSNamed
		}
		if update.NumSSHConn > 0 && update.NumSSHConn > tdata.NumSSHConn {
			tdata.NumSSHConn = update.NumSSHConn
		}
		if update.NumWSLConn > 0 && update.NumWSLConn > tdata.NumWSLConn {
			tdata.NumWSLConn = update.NumWSLConn
		}
		if len(update.Renderers) > 0 {
			if tdata.Renderers == nil {
				tdata.Renderers = make(map[string]int)
			}
			for key, val := range update.Renderers {
				tdata.Renderers[key] += val
			}
		}
		if len(update.WshCmds) > 0 {
			if tdata.WshCmds == nil {
				tdata.WshCmds = make(map[string]int)
			}
			for key, val := range update.WshCmds {
				tdata.WshCmds[key] += val
			}
		}
		if len(update.Conn) > 0 {
			if tdata.Conn == nil {
				tdata.Conn = make(map[string]int)
			}
			for key, val := range update.Conn {
				tdata.Conn[key] += val
			}
		}
		if len(update.Displays) > 0 {
			tdata.Displays = update.Displays
		}
		if len(update.Blocks) > 0 {
			tdata.Blocks = update.Blocks
		}
		query = `UPDATE db_activity
                 SET tdata = ?,
                     clientversion = ?,
                     buildtime = ?
                 WHERE day = ?`
		tx.Exec(query, tdata, wavebase.WaveVersion, wavebase.BuildTime, dayStr)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func GetNonUploadedActivity(ctx context.Context) ([]*ActivityType, error) {
	var rtn []*ActivityType
	txErr := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		query := `SELECT * FROM db_activity WHERE uploaded = 0 ORDER BY day DESC LIMIT 30`
		tx.Select(&rtn, query)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func MarkActivityAsUploaded(ctx context.Context, activityArr []*ActivityType) error {
	dayStr := daystr.GetCurDayStr()
	txErr := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		query := `UPDATE db_activity SET uploaded = 1 WHERE day = ?`
		for _, activity := range activityArr {
			if activity.Day == dayStr {
				continue
			}
			tx.Exec(query, activity.Day)
		}
		return nil
	})
	return txErr
}
