// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package history

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

type HistoryItemType struct {
	HistoryId  string               `json:"historyid"`
	Ts         int64                `json:"ts"`
	UserId     string               `json:"userid"`
	SessionId  string               `json:"sessionid"`
	ScreenId   string               `json:"screenid"`
	LineId     string               `json:"lineid"`
	HadError   bool                 `json:"haderror"`
	CmdStr     string               `json:"cmdstr"`
	Remote     sstore.RemotePtrType `json:"remote"`
	IsMetaCmd  bool                 `json:"ismetacmd"`
	ExitCode   *int64               `json:"exitcode,omitempty"`
	DurationMs *int64               `json:"durationms,omitempty"`
	FeState    sstore.FeStateType   `json:"festate,omitempty"`
	Tags       map[string]bool      `json:"tags,omitempty"`
	LineNum    int64                `json:"linenum" dbmap:"-"`
	Status     string               `json:"status"`

	// only for updates
	Remove bool `json:"remove" dbmap:"-"`

	// transient (string because of different history orderings)
	HistoryNum string `json:"historynum" dbmap:"-"`
}

func (h *HistoryItemType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["historyid"] = h.HistoryId
	rtn["ts"] = h.Ts
	rtn["userid"] = h.UserId
	rtn["sessionid"] = h.SessionId
	rtn["screenid"] = h.ScreenId
	rtn["lineid"] = h.LineId
	rtn["linenum"] = h.LineNum
	rtn["haderror"] = h.HadError
	rtn["cmdstr"] = h.CmdStr
	rtn["remoteownerid"] = h.Remote.OwnerId
	rtn["remoteid"] = h.Remote.RemoteId
	rtn["remotename"] = h.Remote.Name
	rtn["ismetacmd"] = h.IsMetaCmd
	rtn["exitcode"] = h.ExitCode
	rtn["durationms"] = h.DurationMs
	rtn["festate"] = dbutil.QuickJson(h.FeState)
	rtn["tags"] = dbutil.QuickJson(h.Tags)
	rtn["status"] = h.Status
	return rtn
}

func (h *HistoryItemType) FromMap(m map[string]interface{}) bool {
	dbutil.QuickSetStr(&h.HistoryId, m, "historyid")
	dbutil.QuickSetInt64(&h.Ts, m, "ts")
	dbutil.QuickSetStr(&h.UserId, m, "userid")
	dbutil.QuickSetStr(&h.SessionId, m, "sessionid")
	dbutil.QuickSetStr(&h.ScreenId, m, "screenid")
	dbutil.QuickSetStr(&h.LineId, m, "lineid")
	dbutil.QuickSetBool(&h.HadError, m, "haderror")
	dbutil.QuickSetStr(&h.CmdStr, m, "cmdstr")
	dbutil.QuickSetStr(&h.Remote.OwnerId, m, "remoteownerid")
	dbutil.QuickSetStr(&h.Remote.RemoteId, m, "remoteid")
	dbutil.QuickSetStr(&h.Remote.Name, m, "remotename")
	dbutil.QuickSetBool(&h.IsMetaCmd, m, "ismetacmd")
	dbutil.QuickSetStr(&h.HistoryNum, m, "historynum")
	dbutil.QuickSetInt64(&h.LineNum, m, "linenum")
	dbutil.QuickSetNullableInt64(&h.ExitCode, m, "exitcode")
	dbutil.QuickSetNullableInt64(&h.DurationMs, m, "durationms")
	dbutil.QuickSetJson(&h.FeState, m, "festate")
	dbutil.QuickSetJson(&h.Tags, m, "tags")
	dbutil.QuickSetStr(&h.Status, m, "status")
	return true
}

type HistoryQueryOpts struct {
	Offset     int
	MaxItems   int
	FromTs     int64
	SearchText string
	SessionId  string
	RemoteId   string
	ScreenId   string
	NoMeta     bool
	RawOffset  int
	FilterFn   func(*HistoryItemType) bool
}

type HistoryQueryResult struct {
	MaxItems      int
	Items         []*HistoryItemType
	Offset        int // the offset shown to user
	RawOffset     int // internal offset
	HasMore       bool
	NextRawOffset int // internal offset used by pager for next query

	prevItems int // holds number of items skipped by RawOffset
}

type HistoryViewData struct {
	Items         []*HistoryItemType `json:"items"`
	Offset        int                `json:"offset"`
	RawOffset     int                `json:"rawoffset"`
	NextRawOffset int                `json:"nextrawoffset"`
	HasMore       bool               `json:"hasmore"`
	Lines         []*sstore.LineType `json:"lines"`
	Cmds          []*sstore.CmdType  `json:"cmds"`
}

const HistoryCols = "h.historyid, h.ts, h.userid, h.sessionid, h.screenid, h.lineid, h.haderror, h.cmdstr, h.remoteownerid, h.remoteid, h.remotename, h.ismetacmd, h.linenum, h.exitcode, h.durationms, h.festate, h.tags, h.status"
const DefaultMaxHistoryItems = 1000

func InsertHistoryItem(ctx context.Context, hitem *HistoryItemType) error {
	if hitem == nil {
		return fmt.Errorf("cannot insert nil history item")
	}
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `INSERT INTO history 
                  ( historyid, ts, userid, sessionid, screenid, lineid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd, linenum, exitcode, durationms, festate, tags, status) VALUES
                  (:historyid,:ts,:userid,:sessionid,:screenid,:lineid,:haderror,:cmdstr,:remoteownerid,:remoteid,:remotename,:ismetacmd,:linenum,:exitcode,:durationms,:festate,:tags,:status)`
		tx.NamedExec(query, hitem.ToMap())
		return nil
	})
	return txErr
}

const HistoryQueryChunkSize = 1000

func _getNextHistoryItem(items []*HistoryItemType, index int, filterFn func(*HistoryItemType) bool) (*HistoryItemType, int) {
	for ; index < len(items); index++ {
		item := items[index]
		if filterFn(item) {
			return item, index
		}
	}
	return nil, index
}

// returns true if done, false if we still need to process more items
func (result *HistoryQueryResult) processItem(item *HistoryItemType, rawOffset int) bool {
	if result.prevItems < result.Offset {
		result.prevItems++
		return false
	}
	if len(result.Items) == result.MaxItems {
		result.HasMore = true
		result.NextRawOffset = rawOffset
		return true
	}
	if len(result.Items) == 0 {
		result.RawOffset = rawOffset
	}
	result.Items = append(result.Items, item)
	return false
}

func runHistoryQueryWithFilter(tx *sstore.TxWrap, opts HistoryQueryOpts) (*HistoryQueryResult, error) {
	if opts.MaxItems == 0 {
		return nil, fmt.Errorf("invalid query, maxitems is 0")
	}
	rtn := &HistoryQueryResult{Offset: opts.Offset, MaxItems: opts.MaxItems}
	var rawOffset int
	if opts.RawOffset >= opts.Offset {
		rtn.prevItems = opts.Offset
		rawOffset = opts.RawOffset
	} else {
		rawOffset = 0
	}
	for {
		resultItems, err := runHistoryQuery(tx, opts, rawOffset, HistoryQueryChunkSize)
		if err != nil {
			return nil, err
		}
		isDone := false
		for resultIdx := 0; resultIdx < len(resultItems); resultIdx++ {
			if opts.FilterFn != nil && !opts.FilterFn(resultItems[resultIdx]) {
				continue
			}
			isDone = rtn.processItem(resultItems[resultIdx], rawOffset+resultIdx)
			if isDone {
				break
			}
		}
		if isDone {
			break
		}
		if len(resultItems) < HistoryQueryChunkSize {
			break
		}
		rawOffset += HistoryQueryChunkSize
	}
	return rtn, nil
}

func runHistoryQuery(tx *sstore.TxWrap, opts HistoryQueryOpts, realOffset int, itemLimit int) ([]*HistoryItemType, error) {
	// check sessionid/screenid format because we are directly inserting them into the SQL
	if opts.SessionId != "" {
		_, err := uuid.Parse(opts.SessionId)
		if err != nil {
			return nil, fmt.Errorf("malformed sessionid")
		}
	}
	if opts.ScreenId != "" {
		_, err := uuid.Parse(opts.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("malformed screenid")
		}
	}
	if opts.RemoteId != "" {
		_, err := uuid.Parse(opts.RemoteId)
		if err != nil {
			return nil, fmt.Errorf("malformed remoteid")
		}
	}
	whereClause := "WHERE 1"
	var queryArgs []interface{}
	hNumStr := ""
	if opts.SessionId != "" && opts.ScreenId != "" {
		whereClause += fmt.Sprintf(" AND h.sessionid = '%s' AND h.screenid = '%s'", opts.SessionId, opts.ScreenId)
		hNumStr = ""
	} else if opts.SessionId != "" {
		whereClause += fmt.Sprintf(" AND h.sessionid = '%s'", opts.SessionId)
		hNumStr = "s"
	} else {
		hNumStr = "g"
	}
	if opts.SearchText != "" {
		whereClause += " AND h.cmdstr LIKE ? ESCAPE '\\'"
		likeArg := opts.SearchText
		likeArg = strings.ReplaceAll(likeArg, "%", "\\%")
		likeArg = strings.ReplaceAll(likeArg, "_", "\\_")
		queryArgs = append(queryArgs, "%"+likeArg+"%")
	}
	if opts.FromTs > 0 {
		whereClause += fmt.Sprintf(" AND h.ts <= %d", opts.FromTs)
	}
	if opts.RemoteId != "" {
		whereClause += fmt.Sprintf(" AND h.remoteid = '%s'", opts.RemoteId)
	}
	if opts.NoMeta {
		whereClause += " AND NOT h.ismetacmd"
	}
	query := fmt.Sprintf("SELECT %s, ('%s' || CAST((row_number() OVER win) as text)) historynum FROM history h %s WINDOW win AS (ORDER BY h.ts, h.historyid) ORDER BY h.ts DESC, h.historyid DESC LIMIT %d OFFSET %d", HistoryCols, hNumStr, whereClause, itemLimit, realOffset)
	marr := tx.SelectMaps(query, queryArgs...)
	rtn := make([]*HistoryItemType, len(marr))
	for idx, m := range marr {
		hitem := dbutil.FromMap[*HistoryItemType](m)
		rtn[idx] = hitem
	}
	return rtn, nil
}

func GetHistoryItems(ctx context.Context, opts HistoryQueryOpts) (*HistoryQueryResult, error) {
	var rtn *HistoryQueryResult
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		var err error
		rtn, err = runHistoryQueryWithFilter(tx, opts)
		if err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetHistoryItemByLineNum(ctx context.Context, screenId string, lineNum int) (*HistoryItemType, error) {
	return sstore.WithTxRtn(ctx, func(tx *sstore.TxWrap) (*HistoryItemType, error) {
		query := `SELECT * FROM history WHERE screenid = ? AND linenum = ?`
		hitem := dbutil.GetMapGen[*HistoryItemType](tx, query, screenId, lineNum)
		return hitem, nil
	})
}

func GetLastHistoryLineNum(ctx context.Context, screenId string) (int, error) {
	return sstore.WithTxRtn(ctx, func(tx *sstore.TxWrap) (int, error) {
		query := `SELECT COALESCE(max(linenum), 0) FROM history WHERE screenid = ?`
		maxLineNum := tx.GetInt(query, screenId)
		return maxLineNum, nil
	})
}

func getLineIdsFromHistoryItems(historyItems []*HistoryItemType) []string {
	var rtn []string
	for _, hitem := range historyItems {
		if hitem.LineId != "" {
			rtn = append(rtn, hitem.LineId)
		}
	}
	return rtn
}

func GetLineCmdsFromHistoryItems(ctx context.Context, historyItems []*HistoryItemType) ([]*sstore.LineType, []*sstore.CmdType, error) {
	if len(historyItems) == 0 {
		return nil, nil, nil
	}
	return sstore.WithTxRtn3(ctx, func(tx *sstore.TxWrap) ([]*sstore.LineType, []*sstore.CmdType, error) {
		lineIdsJsonArr := dbutil.QuickJsonArr(getLineIdsFromHistoryItems(historyItems))
		query := `SELECT * FROM line WHERE lineid IN (SELECT value FROM json_each(?))`
		lineArr := dbutil.SelectMappable[*sstore.LineType](tx, query, lineIdsJsonArr)
		query = `SELECT * FROM cmd WHERE lineid IN (SELECT value FROM json_each(?))`
		cmdArr := dbutil.SelectMapsGen[*sstore.CmdType](tx, query, lineIdsJsonArr)
		return lineArr, cmdArr, nil
	})
}

func PurgeHistoryByIds(ctx context.Context, historyIds []string) error {
	return sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `DELETE FROM history WHERE historyid IN (SELECT value FROM json_each(?))`
		tx.Exec(query, dbutil.QuickJsonArr(historyIds))
		return nil
	})
}
