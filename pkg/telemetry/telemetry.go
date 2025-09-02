// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetry

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/daystr"
	"github.com/wavetermdev/waveterm/pkg/util/dbutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const MaxTzNameLen = 50
const ActivityEventName = "app:activity"

var cachedTosAgreedTs atomic.Int64

func GetTosAgreedTs() int64 {
	cached := cachedTosAgreedTs.Load()
	if cached != 0 {
		return cached
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil || client == nil || client.TosAgreed == 0 {
		return 0
	}

	cachedTosAgreedTs.Store(client.TosAgreed)
	return client.TosAgreed
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
		defer func() {
			panichandler.PanicHandlerNoTelemetry("GoUpdateActivityWrap", recover())
		}()
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		err := UpdateActivity(ctx, update)
		if err != nil {
			// ignore error, just log, since this is not critical
			log.Printf("error updating current activity (%s): %v\n", debugStr, err)
		}
	}()
}

func insertTEvent(ctx context.Context, event *telemetrydata.TEvent) error {
	if event.Uuid == "" {
		return fmt.Errorf("cannot insert TEvent: uuid is empty")
	}
	if event.Ts == 0 {
		return fmt.Errorf("cannot insert TEvent: ts is 0")
	}
	if event.TsLocal == "" {
		return fmt.Errorf("cannot insert TEvent: tslocal is empty")
	}
	if event.Event == "" {
		return fmt.Errorf("cannot insert TEvent: event is empty")
	}
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		query := `INSERT INTO db_tevent (uuid, ts, tslocal, event, props)
				  VALUES (?, ?, ?, ?, ?)`
		tx.Exec(query, event.Uuid, event.Ts, event.TsLocal, event.Event, dbutil.QuickJson(event.Props))
		return nil
	})
}

// merges newActivity into curActivity, returns curActivity
func mergeActivity(curActivity *telemetrydata.TEventProps, newActivity telemetrydata.TEventProps) {
	curActivity.ActiveMinutes += newActivity.ActiveMinutes
	curActivity.FgMinutes += newActivity.FgMinutes
	curActivity.OpenMinutes += newActivity.OpenMinutes
}

// ignores the timestamp in tevent, and uses the current time
func updateActivityTEvent(ctx context.Context, tevent *telemetrydata.TEvent) error {
	eventTs := time.Now()
	// compute to hour boundary, and round up to next hour
	eventTs = eventTs.Truncate(time.Hour).Add(time.Hour)

	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		// find event that matches this timestamp with event name "app:activity"
		var hasRow bool
		var curActivity telemetrydata.TEventProps
		uuidStr := tx.GetString(`SELECT uuid FROM db_tevent WHERE ts = ? AND event = ?`, eventTs.UnixMilli(), ActivityEventName)
		if uuidStr != "" {
			hasRow = true
			rawProps := tx.GetString(`SELECT props FROM db_tevent WHERE uuid = ?`, uuidStr)
			err := json.Unmarshal([]byte(rawProps), &curActivity)
			if err != nil {
				// ignore, curActivity will just be 0
				log.Printf("error unmarshalling activity props: %v\n", err)
			}
		}
		mergeActivity(&curActivity, tevent.Props)

		if hasRow {
			query := `UPDATE db_tevent SET props = ? WHERE uuid = ?`
			tx.Exec(query, dbutil.QuickJson(curActivity), uuidStr)
		} else {
			query := `INSERT INTO db_tevent (uuid, ts, tslocal, event, props) VALUES (?, ?, ?, ?, ?)`
			tsLocal := utilfn.ConvertToWallClockPT(eventTs).Format(time.RFC3339)
			tx.Exec(query, uuid.New().String(), eventTs.UnixMilli(), tsLocal, ActivityEventName, dbutil.QuickJson(curActivity))
		}
		return nil
	})
}

func TruncateActivityTEventForShutdown(ctx context.Context) error {
	nowTs := time.Now()
	eventTs := nowTs.Truncate(time.Hour).Add(time.Hour)
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		// find event that matches this timestamp with event name "app:activity"
		uuidStr := tx.GetString(`SELECT uuid FROM db_tevent WHERE ts = ? AND event = ?`, eventTs.UnixMilli(), ActivityEventName)
		if uuidStr == "" {
			return nil
		}
		// we're going to update this app:activity event back to nowTs
		tsLocal := utilfn.ConvertToWallClockPT(nowTs).Format(time.RFC3339)
		query := `UPDATE db_tevent SET ts = ?, tslocal = ? WHERE uuid = ?`
		tx.Exec(query, nowTs.UnixMilli(), tsLocal, uuidStr)
		return nil
	})
}

func GoRecordTEventWrap(tevent *telemetrydata.TEvent) {
	if tevent == nil || tevent.Event == "" {
		return
	}
	go func() {
		defer func() {
			panichandler.PanicHandlerNoTelemetry("GoRecordTEventWrap", recover())
		}()
		ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelFn()
		err := RecordTEvent(ctx, tevent)
		if err != nil {
			// ignore error, just log, since this is not critical
			log.Printf("error recording %q telemetry event: %v\n", tevent.Event, err)
		}
	}()
}

func RecordTEvent(ctx context.Context, tevent *telemetrydata.TEvent) error {
	if tevent == nil {
		return nil
	}
	if tevent.Uuid == "" {
		tevent.Uuid = uuid.New().String()
	}
	err := tevent.Validate(true)
	if err != nil {
		return err
	}
	tevent.EnsureTimestamps()

	// Set AppFirstDay if within first day of TOS agreement
	tosAgreedTs := GetTosAgreedTs()
	if tosAgreedTs == 0 || (tosAgreedTs != 0 && time.Now().UnixMilli()-tosAgreedTs <= int64(24*60*60*1000)) {
		tevent.Props.AppFirstDay = true
	}

	if tevent.Event == ActivityEventName {
		return updateActivityTEvent(ctx, tevent)
	}
	return insertTEvent(ctx, tevent)
}

func CleanOldTEvents(ctx context.Context) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		// delete events older than 28 days
		query := `DELETE FROM db_tevent WHERE ts < ?`
		olderThan := time.Now().AddDate(0, 0, -28).UnixMilli()
		tx.Exec(query, olderThan)
		return nil
	})
}

func GetNonUploadedTEvents(ctx context.Context, maxEvents int) ([]*telemetrydata.TEvent, error) {
	now := time.Now()
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) ([]*telemetrydata.TEvent, error) {
		var rtn []*telemetrydata.TEvent
		query := `SELECT uuid, ts, tslocal, event, props, uploaded FROM db_tevent WHERE uploaded = 0 AND ts <= ? ORDER BY ts LIMIT ?`
		tx.Select(&rtn, query, now.UnixMilli(), maxEvents)
		for _, event := range rtn {
			if err := event.ConvertRawJSON(); err != nil {
				return nil, fmt.Errorf("scan json for event %s: %w", event.Uuid, err)
			}
		}
		return rtn, nil
	})
}

func MarkTEventsAsUploaded(ctx context.Context, events []*telemetrydata.TEvent) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ids := make([]string, 0, len(events))
		for _, event := range events {
			ids = append(ids, event.Uuid)
		}
		query := `UPDATE db_tevent SET uploaded = 1 WHERE uuid IN (SELECT value FROM json_each(?))`
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
