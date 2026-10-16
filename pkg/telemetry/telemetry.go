// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package telemetry retains compatibility types for existing RPC clients and databases.
// Collection is removed: no events or activity are recorded, regardless of settings.
package telemetry

import (
	"context"
	"database/sql/driver"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/dbutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
	"sync/atomic"
	"time"
)

const MaxTzNameLen = 50
const ActivityEventName = "app:activity"
const WshRunEventName = "wsh:run"

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
	ActiveMinutes       int                          `json:"activeminutes"`
	FgMinutes           int                          `json:"fgminutes"`
	OpenMinutes         int                          `json:"openminutes"`
	WaveAIActiveMinutes int                          `json:"waveaiactiveminutes,omitempty"`
	WaveAIFgMinutes     int                          `json:"waveaifgminutes,omitempty"`
	NumTabs             int                          `json:"numtabs"`
	NumBlocks           int                          `json:"numblocks,omitempty"`
	NumWindows          int                          `json:"numwindows,omitempty"`
	NumWS               int                          `json:"numws,omitempty"`
	NumWSNamed          int                          `json:"numwsnamed,omitempty"`
	NumSSHConn          int                          `json:"numsshconn,omitempty"`
	NumWSLConn          int                          `json:"numwslconn,omitempty"`
	NumMagnify          int                          `json:"nummagnify,omitempty"`
	NewTab              int                          `json:"newtab"`
	NumStartup          int                          `json:"numstartup,omitempty"`
	NumShutdown         int                          `json:"numshutdown,omitempty"`
	NumPanics           int                          `json:"numpanics,omitempty"`
	NumAIReqs           int                          `json:"numaireqs,omitempty"`
	SetTabTheme         int                          `json:"settabtheme,omitempty"`
	Displays            []wshrpc.ActivityDisplayType `json:"displays,omitempty"`
	Renderers           map[string]int               `json:"renderers,omitempty"`
	Blocks              map[string]int               `json:"blocks,omitempty"`
	WshCmds             map[string]int               `json:"wshcmds,omitempty"`
	Conn                map[string]int               `json:"conn,omitempty"`
}

func (tdata TelemetryData) Value() (driver.Value, error) {
	return dbutil.QuickValueJson(tdata)
}

func (tdata *TelemetryData) Scan(val interface{}) error {
	return dbutil.QuickScanJson(tdata, val)
}

func IsAutoUpdateEnabled() bool {
	settings := wconfig.GetWatcher().GetFullConfig()
	return settings.Settings.AutoUpdateEnabled
}

func AutoUpdateChannel() string {
	settings := wconfig.GetWatcher().GetFullConfig()
	return settings.Settings.AutoUpdateChannel
}

func IsTelemetryEnabled() bool                                                    { return false }
func GoUpdateActivityWrap(wshrpc.ActivityUpdate, string)                          {}
func GoRecordTEventWrap(*telemetrydata.TEvent)                                    {}
func RecordTEvent(context.Context, *telemetrydata.TEvent) error                   { return nil }
func UpdateActivity(context.Context, wshrpc.ActivityUpdate) error                 { return nil }
func TruncateActivityTEventForShutdown(context.Context) error                     { return nil }
func CleanOldTEvents(context.Context) error                                       { return nil }
func GetNonUploadedTEvents(context.Context, int) ([]*telemetrydata.TEvent, error) { return nil, nil }
func MarkTEventsAsUploaded(context.Context, []*telemetrydata.TEvent) error        { return nil }
func GetNonUploadedActivity(context.Context) ([]*ActivityType, error)             { return nil, nil }
func MarkActivityAsUploaded(context.Context, []*ActivityType) error               { return nil }
