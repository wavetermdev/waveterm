// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetry

import (
	"context"
	"database/sql/driver"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/daystr"
	"github.com/wavetermdev/waveterm/pkg/util/dbutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const MaxTzNameLen = 50

// "terminal" should not be in this list
var allowedRenderers = map[string]bool{
	"markdown": true,
	"code":     true,
	"openai":   true,
	"csv":      true,
	"image":    true,
	"pdf":      true,
	"media":    true,
	"mustache": true,
}

type ActivityUpdate struct {
	FgMinutes     int
	ActiveMinutes int
	OpenMinutes   int
	NumTabs       int
	NewTab        int
	Startup       int
	Shutdown      int
	BuildTime     string
	Renderers     map[string]int
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
	ActiveMinutes int            `json:"activeminutes"`
	FgMinutes     int            `json:"fgminutes"`
	OpenMinutes   int            `json:"openminutes"`
	NumTabs       int            `json:"numtabs"`
	NewTab        int            `json:"newtab"`
	NumStartup    int            `json:"numstartup,omitempty"`
	NumShutdown   int            `json:"numshutdown,omitempty"`
	Renderers     map[string]int `json:"renderers,omitempty"`
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

func IsAllowedRenderer(renderer string) bool {
	return allowedRenderers[renderer]
}

// Wraps UpdateCurrentActivity, spawns goroutine, and logs errors
func GoUpdateActivityWrap(update ActivityUpdate, debugStr string) {
	go func() {
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		err := UpdateActivity(ctx, update)
		if err != nil {
			// ignore error, just log, since this is not critical
			log.Printf("error updating current activity (%s): %v\n", debugStr, err)
		}
	}()
}

func UpdateActivity(ctx context.Context, update ActivityUpdate) error {
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
		if update.NumTabs > 0 {
			tdata.NumTabs = update.NumTabs
		}
		if len(update.Renderers) > 0 {
			if tdata.Renderers == nil {
				tdata.Renderers = make(map[string]int)
			}
			for key, val := range update.Renderers {
				tdata.Renderers[key] += val
			}
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
