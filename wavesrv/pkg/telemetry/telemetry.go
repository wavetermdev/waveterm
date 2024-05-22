// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetry

import (
	"context"
	"database/sql/driver"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"time"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
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
	FgMinutes        int
	ActiveMinutes    int
	OpenMinutes      int
	NumCommands      int
	ClickShared      int
	HistoryView      int
	BookmarksView    int
	NumConns         int
	NumWorkspaces    int
	NumTabs          int
	NewTab           int
	ReinitBashErrors int
	ReinitZshErrors  int
	Startup          int
	Shutdown         int
	FeAIChatOpen     int
	FeHistoryOpen    int
	FeAiCmdInfoOpen  int
	BuildTime        string
	Renderers        map[string]int
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
	NumCommands      int            `json:"numcommands"`
	ActiveMinutes    int            `json:"activeminutes"`
	FgMinutes        int            `json:"fgminutes"`
	OpenMinutes      int            `json:"openminutes"`
	ClickShared      int            `json:"clickshared,omitempty"`
	HistoryView      int            `json:"historyview,omitempty"`
	BookmarksView    int            `json:"bookmarksview,omitempty"`
	NumConns         int            `json:"numconns"`
	NumWorkspaces    int            `json:"numworkspaces"`
	NumTabs          int            `json:"numtabs"`
	NewTab           int            `json:"newtab"`
	NumStartup       int            `json:"numstartup,omitempty"`
	NumShutdown      int            `json:"numshutdown,omitempty"`
	NumAIChatOpen    int            `json:"numaichatopen,omitempty"`
	NumHistoryOpen   int            `json:"numhistoryopen,omitempty"`
	ReinitBashErrors int            `json:"reinitbasherrors,omitempty"`
	ReinitZshErrors  int            `json:"reinitzsherrors,omitempty"`
	Renderers        map[string]int `json:"renderers,omitempty"`
}

func (tdata TelemetryData) Value() (driver.Value, error) {
	return dbutil.QuickValueJson(tdata)
}

func (tdata *TelemetryData) Scan(val interface{}) error {
	return dbutil.QuickScanJson(tdata, val)
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
	m := customDayStrRe.FindStringSubmatch(format)
	if m == nil {
		return "", fmt.Errorf("invalid daystr format")
	}
	prefix, deltas := m[1], m[2]
	if prefix == "" {
		prefix = "today"
	}
	var rtnTime time.Time
	now := time.Now()
	switch prefix {
	case "today":
		rtnTime = now
	case "yesterday":
		rtnTime = now.AddDate(0, 0, -1)
	case "bom":
		rtnTime = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	case "bow":
		weekday := now.Weekday()
		if weekday == time.Sunday {
			rtnTime = now
		} else {
			rtnTime = now.AddDate(0, 0, -int(weekday))
		}
	default:
		m = daystrRe.FindStringSubmatch(prefix)
		if m == nil {
			return "", fmt.Errorf("invalid prefix format")
		}
		year, month, day := m[1], m[2], m[3]
		yearInt, monthInt, dayInt := atoiNoErr(year), atoiNoErr(month), atoiNoErr(day)
		if yearInt == 0 || monthInt == 0 || dayInt == 0 {
			return "", fmt.Errorf("invalid prefix format")
		}
		rtnTime = time.Date(yearInt, time.Month(monthInt), dayInt, 0, 0, 0, 0, now.Location())
	}
	for _, delta := range regexp.MustCompile(`[+-]\d+[dwm]`).FindAllString(deltas, -1) {
		deltaVal, err := strconv.Atoi(delta[1 : len(delta)-1])
		if err != nil {
			return "", fmt.Errorf("invalid delta format")
		}
		if delta[0] == '-' {
			deltaVal = -deltaVal
		}
		switch delta[len(delta)-1] {
		case 'd':
			rtnTime = rtnTime.AddDate(0, 0, deltaVal)
		case 'w':
			rtnTime = rtnTime.AddDate(0, 0, deltaVal*7)
		case 'm':
			rtnTime = rtnTime.AddDate(0, deltaVal, 0)
		}
	}
	return rtnTime.Format("2006-01-02"), nil
}

func atoiNoErr(str string) int {
	val, err := strconv.Atoi(str)
	if err != nil {
		return 0
	}
	return val
}

func UpdateFeActivityWrap(feActivity *scpacket.FeActivityPacketType) {
	update := ActivityUpdate{}
	for key, val := range feActivity.Activity {
		if key == "aichat-open" {
			update.FeAIChatOpen = val
		} else if key == "history-open" {
			update.FeHistoryOpen = val
		} else if key == "aicmdinfo-open" {
			update.FeAiCmdInfoOpen = val
		} else {
			log.Printf("unknown feactivity key: %s\n", key)
		}
	}
	GoUpdateActivityWrap(update, "feactivity")
}

var customDayStrRe = regexp.MustCompile(`^((?:\d{4}-\d{2}-\d{2})|today|yesterday|bom|bow)?((?:[+-]\d+[dwm])*)$`)
var daystrRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

func UpdateActivity(ctx context.Context, update ActivityUpdate) error {
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
		tdata.NewTab += update.NewTab
		tdata.NumStartup += update.Startup
		tdata.NumShutdown += update.Shutdown
		tdata.NumAIChatOpen += update.FeAIChatOpen
		tdata.NumHistoryOpen += update.FeHistoryOpen
		if update.NumConns > 0 {
			tdata.NumConns = update.NumConns
		}
		if update.NumWorkspaces > 0 {
			tdata.NumWorkspaces = update.NumWorkspaces
		}
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
