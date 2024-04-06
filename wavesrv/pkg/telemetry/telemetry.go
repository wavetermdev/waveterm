// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetry

import (
	"context"
	"database/sql/driver"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

const MaxTzNameLen = 50

type ActivityUpdate struct {
	FgMinutes        int
	ActiveMinutes    int
	OpenMinutes      int
	NumCommands      int
	ClickShared      int
	HistoryView      int
	BookmarksView    int
	NumConns         int
	WebShareLimit    int
	ReinitBashErrors int
	ReinitZshErrors  int
	BuildTime        string
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
	DefaultShell  string        `json:"defaultshell"`
	OSRelease     string        `json:"osrelease"`
}

type TelemetryData struct {
	NumCommands      int `json:"numcommands"`
	ActiveMinutes    int `json:"activeminutes"`
	FgMinutes        int `json:"fgminutes"`
	OpenMinutes      int `json:"openminutes"`
	ClickShared      int `json:"clickshared,omitempty"`
	HistoryView      int `json:"historyview,omitempty"`
	BookmarksView    int `json:"bookmarksview,omitempty"`
	NumConns         int `json:"numconns"`
	WebShareLimit    int `json:"websharelimit,omitempty"`
	ReinitBashErrors int `json:"reinitbasherrors,omitempty"`
	ReinitZshErrors  int `json:"reinitzsherrors,omitempty"`
}

func (tdata TelemetryData) Value() (driver.Value, error) {
	return dbutil.QuickValueJson(tdata)
}

func (tdata *TelemetryData) Scan(val interface{}) error {
	return dbutil.QuickScanJson(tdata, val)
}

// Wraps UpdateCurrentActivity, but ignores errors
func UpdateActivityWrap(ctx context.Context, update ActivityUpdate, debugStr string) {
	err := UpdateCurrentActivity(ctx, update)
	if err != nil {
		// ignore error, just log, since this is not critical
		log.Printf("error updating current activity (%s): %v\n", debugStr, err)
	}
}

func GetCurDayStr() string {
	now := time.Now()
	dayStr := now.Format("2006-01-02")
	return dayStr
}

func GetRelDayStr(relDays int) string {
	now := time.Now()
	dayStr := now.AddDate(0, 0, relDays).Format("2006-01-02")
	return dayStr
}

// accepts a custom format string to return a daystr
// can be either a prefix, a delta, or a prefix w/ a delta
// if no prefix is given, "today" is assumed
// examples: today-2d, bow, bom+1m-1d (that's end of the month), 2024-04-01+1w
//
// prefixes:
//
//	yyyy-mm-dd
//	today
//	yesterday
//	bom (beginning of month)
//	bow (beginning of week -- sunday)
//
// deltas:
//
//	+[n]d, -[n]d (e.g. +1d, -5d)
//	+[n]w, -[n]w (e.g. +2w)
//	+[n]m, -[n]m (e.g. -1m)
//	deltas can be combined e.g. +1w-2d
func GetCustomDayStr(format string) (string, error) {
	return "", nil
}

func UpdateCurrentActivity(ctx context.Context, update ActivityUpdate) error {
	now := time.Now()
	dayStr := GetCurDayStr()
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		var tdata TelemetryData
		query := `SELECT tdata FROM activity WHERE day = ?`
		found := tx.Get(&tdata, query, dayStr)
		if !found {
			query = `INSERT INTO activity (day, uploaded, tdata, tzname, tzoffset, clientversion, clientarch, buildtime, osrelease)
                                   VALUES (?,   0,        ?,     ?,      ?,        ?,             ?         , ?        , ?)`
			tzName, tzOffset := now.Zone()
			if len(tzName) > MaxTzNameLen {
				tzName = tzName[0:MaxTzNameLen]
			}
			tx.Exec(query, dayStr, tdata, tzName, tzOffset, scbase.WaveVersion, scbase.ClientArch(), scbase.BuildTime, scbase.UnameKernelRelease())
		}
		tdata.NumCommands += update.NumCommands
		tdata.FgMinutes += update.FgMinutes
		tdata.ActiveMinutes += update.ActiveMinutes
		tdata.OpenMinutes += update.OpenMinutes
		tdata.ClickShared += update.ClickShared
		tdata.HistoryView += update.HistoryView
		tdata.BookmarksView += update.BookmarksView
		tdata.ReinitBashErrors += update.ReinitBashErrors
		tdata.ReinitZshErrors += update.ReinitZshErrors
		if update.NumConns > 0 {
			tdata.NumConns = update.NumConns
		}
		query = `UPDATE activity
                 SET tdata = ?,
                     clientversion = ?,
                     buildtime = ?
                 WHERE day = ?`
		tx.Exec(query, tdata, scbase.WaveVersion, scbase.BuildTime, dayStr)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func GetNonUploadedActivity(ctx context.Context) ([]*ActivityType, error) {
	var rtn []*ActivityType
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `SELECT * FROM activity WHERE uploaded = 0 ORDER BY day DESC LIMIT 30`
		tx.Select(&rtn, query)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

// note, will not mark the current day as uploaded
func MarkActivityAsUploaded(ctx context.Context, activityArr []*ActivityType) error {
	dayStr := GetCurDayStr()
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `UPDATE activity SET uploaded = 1 WHERE day = ?`
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
