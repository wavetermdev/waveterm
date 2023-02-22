package sstore

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/sawka/txwrap"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

const HistoryCols = "historyid, ts, userid, sessionid, screenid, windowid, lineid, cmdid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd, incognito"
const DefaultMaxHistoryItems = 1000

type SingleConnDBGetter struct {
	SingleConnLock *sync.Mutex
}

type TxWrap = txwrap.TxWrap

var dbWrap *SingleConnDBGetter

func init() {
	dbWrap = &SingleConnDBGetter{SingleConnLock: &sync.Mutex{}}
}

func (dbg *SingleConnDBGetter) GetDB(ctx context.Context) (*sqlx.DB, error) {
	db, err := GetDB(ctx)
	if err != nil {
		return nil, err
	}
	dbg.SingleConnLock.Lock()
	return db, nil
}

func (dbg *SingleConnDBGetter) ReleaseDB(db *sqlx.DB) {
	dbg.SingleConnLock.Unlock()
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) error {
	return txwrap.DBGWithTx(ctx, dbWrap, fn)
}

func NumSessions(ctx context.Context) (int, error) {
	var numSessions int
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := "SELECT count(*) FROM session"
		numSessions = tx.GetInt(query)
		return nil
	})
	return numSessions, txErr
}

func GetAllRemotes(ctx context.Context) ([]*RemoteType, error) {
	var rtn []*RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote ORDER BY remoteidx`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, RemoteFromMap(m))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func GetRemoteByAlias(ctx context.Context, alias string) (*RemoteType, error) {
	var remote *RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote WHERE remotealias = ?`
		m := tx.GetMap(query, alias)
		remote = RemoteFromMap(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return remote, nil
}

func GetRemoteById(ctx context.Context, remoteId string) (*RemoteType, error) {
	var remote *RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote WHERE remoteid = ?`
		m := tx.GetMap(query, remoteId)
		remote = RemoteFromMap(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return remote, nil
}

func GetLocalRemote(ctx context.Context) (*RemoteType, error) {
	var remote *RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote WHERE local`
		m := tx.GetMap(query)
		remote = RemoteFromMap(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return remote, nil
}

func GetRemoteByCanonicalName(ctx context.Context, cname string) (*RemoteType, error) {
	var remote *RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote WHERE remotecanonicalname = ?`
		m := tx.GetMap(query, cname)
		remote = RemoteFromMap(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return remote, nil
}

func GetRemoteByPhysicalId(ctx context.Context, physicalId string) (*RemoteType, error) {
	var remote *RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote WHERE physicalid = ?`
		m := tx.GetMap(query, physicalId)
		remote = RemoteFromMap(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return remote, nil
}

func UpsertRemote(ctx context.Context, r *RemoteType) error {
	if r == nil {
		return fmt.Errorf("cannot insert nil remote")
	}
	if r.RemoteId == "" {
		return fmt.Errorf("cannot insert remote without id")
	}
	if r.RemoteCanonicalName == "" {
		return fmt.Errorf("cannot insert remote with canonicalname")
	}
	if r.RemoteType == "" {
		return fmt.Errorf("cannot insert remote without type")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT remoteid FROM remote WHERE remoteid = ?`
		if tx.Exists(query, r.RemoteId) {
			tx.Exec(`DELETE FROM remote WHERE remoteid = ?`, r.RemoteId)
		}
		query = `SELECT remoteid FROM remote WHERE remotecanonicalname = ?`
		if tx.Exists(query, r.RemoteCanonicalName) {
			return fmt.Errorf("remote has duplicate canonicalname '%s', cannot create", r.RemoteCanonicalName)
		}
		query = `SELECT remoteid FROM remote WHERE remotealias = ?`
		if r.RemoteAlias != "" && tx.Exists(query, r.RemoteAlias) {
			return fmt.Errorf("remote has duplicate alias '%s', cannot create", r.RemoteAlias)
		}
		query = `SELECT COALESCE(max(remoteidx), 0) FROM remote`
		maxRemoteIdx := tx.GetInt(query)
		r.RemoteIdx = int64(maxRemoteIdx + 1)
		query = `INSERT INTO remote
            ( remoteid, physicalid, remotetype, remotealias, remotecanonicalname, remotesudo, remoteuser, remotehost, connectmode, autoinstall, sshopts, remoteopts, lastconnectts, archived, remoteidx, local) VALUES
            (:remoteid,:physicalid,:remotetype,:remotealias,:remotecanonicalname,:remotesudo,:remoteuser,:remotehost,:connectmode,:autoinstall,:sshopts,:remoteopts,:lastconnectts,:archived,:remoteidx,:local)`
		tx.NamedExec(query, r.ToMap())
		return nil
	})
	return txErr
}

func InsertHistoryItem(ctx context.Context, hitem *HistoryItemType) error {
	if hitem == nil {
		return fmt.Errorf("cannot insert nil history item")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `INSERT INTO history 
                  ( historyid, ts, userid, sessionid, screenid, windowid, lineid, cmdid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd, incognito) VALUES
                  (:historyid,:ts,:userid,:sessionid,:screenid,:windowid,:lineid,:cmdid,:haderror,:cmdstr,:remoteownerid,:remoteid,:remotename,:ismetacmd,:incognito)`
		tx.NamedExec(query, hitem.ToMap())
		return nil
	})
	return txErr
}

func IsIncognitoScreen(ctx context.Context, sessionId string, screenId string) (bool, error) {
	var rtn bool
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT incognito FROM screen WHERE sessionid = ? AND screenid = ?`
		tx.Get(&rtn, query, sessionId, screenId)
		return nil
	})
	return rtn, txErr
}

func runHistoryQuery(tx *TxWrap, sessionId string, windowId string, opts HistoryQueryOpts) ([]*HistoryItemType, error) {
	// check sessionid/windowid format because we are directly inserting them into the SQL
	if sessionId != "" {
		_, err := uuid.Parse(sessionId)
		if err != nil {
			return nil, fmt.Errorf("malformed sessionid")
		}
	}
	if windowId != "" {
		_, err := uuid.Parse(windowId)
		if err != nil {
			return nil, fmt.Errorf("malformed windowid")
		}
	}
	hnumStr := ""
	whereClause := ""
	if sessionId != "" && windowId != "" {
		whereClause = fmt.Sprintf("WHERE sessionid = '%s' AND windowid = '%s'", sessionId, windowId)
		hnumStr = "w"
	} else if sessionId != "" {
		whereClause = fmt.Sprintf("WHERE sessionid = '%s'", sessionId)
		hnumStr = "s"
	} else {
		hnumStr = "g"
	}
	maxItems := opts.MaxItems
	if maxItems == 0 {
		maxItems = DefaultMaxHistoryItems
	}
	query := fmt.Sprintf("SELECT %s, '%s' || row_number() OVER win AS historynum FROM history %s WINDOW win AS (ORDER BY ts, historyid) ORDER BY ts DESC, historyid DESC LIMIT %d", HistoryCols, hnumStr, whereClause, maxItems)
	if opts.FromTs > 0 {
		query = fmt.Sprintf("SELECT * FROM (%s) WHERE ts >= %d", query, opts.FromTs)
	}
	marr := tx.SelectMaps(query)
	rtn := make([]*HistoryItemType, len(marr))
	for idx, m := range marr {
		hitem := HistoryItemFromMap(m)
		rtn[idx] = hitem
	}
	return rtn, nil
}

func GetHistoryItems(ctx context.Context, sessionId string, windowId string, opts HistoryQueryOpts) ([]*HistoryItemType, error) {
	var rtn []*HistoryItemType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var err error
		rtn, err = runHistoryQuery(tx, sessionId, windowId, opts)
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

// includes archived sessions
func GetBareSessions(ctx context.Context) ([]*SessionType, error) {
	var rtn []*SessionType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM session ORDER BY archived, sessionidx, archivedts`
		tx.Select(&rtn, query)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

// does not include archived, finds lowest sessionidx (for resetting active session)
func GetFirstSessionId(ctx context.Context) (string, error) {
	var rtn []string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid from session WHERE NOT archived ORDER by sessionidx`
		rtn = tx.SelectStrings(query)
		return nil
	})
	if txErr != nil {
		return "", txErr
	}
	if len(rtn) == 0 {
		return "", nil
	}
	return rtn[0], nil
}

func GetBareSessionById(ctx context.Context, sessionId string) (*SessionType, error) {
	var rtn SessionType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM session WHERE sessionid = ?`
		tx.Get(&rtn, query, sessionId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	if rtn.SessionId == "" {
		return nil, nil
	}
	return &rtn, nil
}

func GetAllSessions(ctx context.Context) (*ModelUpdate, error) {
	var rtn []*SessionType
	var activeSessionId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM session ORDER BY archived, sessionidx, archivedts`
		tx.Select(&rtn, query)
		sessionMap := make(map[string]*SessionType)
		for _, session := range rtn {
			sessionMap[session.SessionId] = session
			session.Full = true
		}
		var screens []*ScreenType
		query = `SELECT * FROM screen ORDER BY archived, screenidx, archivedts`
		tx.Select(&screens, query)
		screenMap := make(map[string][]*ScreenType)
		for _, screen := range screens {
			screenArr := screenMap[screen.SessionId]
			screenArr = append(screenArr, screen)
			screenMap[screen.SessionId] = screenArr
		}
		for _, session := range rtn {
			session.Screens = screenMap[session.SessionId]
		}
		var sws []*ScreenWindowType
		query = `SELECT * FROM screen_window`
		tx.Select(&sws, query)
		screenIdMap := make(map[string]*ScreenType)
		for _, screen := range screens {
			screenIdMap[screen.SessionId+screen.ScreenId] = screen
		}
		for _, sw := range sws {
			screen := screenIdMap[sw.SessionId+sw.ScreenId]
			if screen == nil {
				continue
			}
			screen.Windows = append(screen.Windows, sw)
		}
		query = `SELECT * FROM remote_instance`
		riMaps := tx.SelectMaps(query)
		for _, m := range riMaps {
			ri := RIFromMap(m)
			s := sessionMap[ri.SessionId]
			if s != nil {
				s.Remotes = append(s.Remotes, ri)
			}
		}
		query = `SELECT activesessionid FROM client`
		activeSessionId = tx.GetString(query)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return &ModelUpdate{Sessions: rtn, ActiveSessionId: activeSessionId}, nil
}

func GetWindowById(ctx context.Context, sessionId string, windowId string) (*WindowType, error) {
	var rtnWindow *WindowType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM window WHERE sessionid = ? AND windowid = ?`
		m := tx.GetMap(query, sessionId, windowId)
		if m == nil {
			return nil
		}
		rtnWindow = WindowFromMap(m)
		query = `SELECT * FROM line WHERE sessionid = ? AND windowid = ? ORDER BY linenum`
		tx.Select(&rtnWindow.Lines, query, sessionId, windowId)
		query = `SELECT * FROM cmd WHERE cmdid IN (SELECT cmdid FROM line WHERE sessionid = ? AND windowid = ?)`
		cmdMaps := tx.SelectMaps(query, sessionId, windowId)
		for _, m := range cmdMaps {
			rtnWindow.Cmds = append(rtnWindow.Cmds, CmdFromMap(m))
		}
		return nil
	})
	return rtnWindow, err
}

// includes archived screens (does not include screen windows)
func GetBareSessionScreens(ctx context.Context, sessionId string) ([]*ScreenType, error) {
	var rtn []*ScreenType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM screen WHERE sessionid = ? ORDER BY archived, screenidx, archivedts`
		tx.Select(&rtn, query, sessionId)
		return nil
	})
	return rtn, txErr
}

func GetSessionById(ctx context.Context, id string) (*SessionType, error) {
	allSessionsUpdate, err := GetAllSessions(ctx)
	if err != nil {
		return nil, err
	}
	allSessions := allSessionsUpdate.Sessions
	for _, session := range allSessions {
		if session.SessionId == id {
			return session, nil
		}
	}
	return nil, nil
}

func GetSessionByName(ctx context.Context, name string) (*SessionType, error) {
	var session *SessionType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE name = ?`
		sessionId := tx.GetString(query, name)
		if sessionId == "" {
			return nil
		}
		var err error
		session, err = GetSessionById(tx.Context(), sessionId)
		if err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return session, nil
}

// also creates default window, returns sessionId
// if sessionName == "", it will be generated
func InsertSessionWithName(ctx context.Context, sessionName string, activate bool) (UpdatePacket, error) {
	newSessionId := scbase.GenPromptUUID()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		names := tx.SelectStrings(`SELECT name FROM session`)
		sessionName = fmtUniqueName(sessionName, "session-%d", len(names)+1, names)
		maxSessionIdx := tx.GetInt(`SELECT COALESCE(max(sessionidx), 0) FROM session`)
		query := `INSERT INTO session (sessionid, name, activescreenid, sessionidx, notifynum, archived, archivedts, ownerid, sharemode, accesskey)
                               VALUES (?,         ?,    '',             ?,          ?,         0,        0,          '',      'local',   '')`
		tx.Exec(query, newSessionId, sessionName, maxSessionIdx+1, 0)
		_, err := InsertScreen(tx.Context(), newSessionId, "", true)
		if err != nil {
			return err
		}
		if activate {
			query = `UPDATE client SET activesessionid = ?`
			tx.Exec(query, newSessionId)
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	session, err := GetSessionById(ctx, newSessionId)
	if err != nil {
		return nil, err
	}
	update := ModelUpdate{
		Sessions: []*SessionType{session},
	}
	if activate {
		update.ActiveSessionId = newSessionId
	}
	return update, nil
}

func SetActiveSessionId(ctx context.Context, sessionId string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("cannot switch to session, not found")
		}
		query = `UPDATE client SET activesessionid = ?`
		tx.Exec(query, sessionId)
		return nil
	})
	return txErr
}

func GetActiveSessionId(ctx context.Context) (string, error) {
	var rtnId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT activesessionid FROM client`
		rtnId = tx.GetString(query)
		return nil
	})
	return rtnId, txErr
}

func SetWinSize(ctx context.Context, winSize ClientWinSizeType) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE client SET winsize = ?`
		tx.Exec(query, quickJson(winSize))
		return nil
	})
	return txErr
}

func containsStr(strs []string, testStr string) bool {
	for _, s := range strs {
		if s == testStr {
			return true
		}
	}
	return false
}

func fmtUniqueName(name string, defaultFmtStr string, startIdx int, strs []string) string {
	var fmtStr string
	if name != "" {
		if !containsStr(strs, name) {
			return name
		}
		fmtStr = name + "-%d"
		startIdx = 2
	} else {
		fmtStr = defaultFmtStr
	}
	if strings.Index(fmtStr, "%d") == -1 {
		panic("invalid fmtStr: " + fmtStr)
	}
	for {
		testName := fmt.Sprintf(fmtStr, startIdx)
		if containsStr(strs, testName) {
			startIdx++
			continue
		}
		return testName
	}
}

func InsertScreen(ctx context.Context, sessionId string, origScreenName string, activate bool) (UpdatePacket, error) {
	var newScreenId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ? AND NOT archived`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("cannot create screen, no session found (or session archived)")
		}
		remoteId := tx.GetString(`SELECT remoteid FROM remote WHERE remotealias = ?`, LocalRemoteAlias)
		if remoteId == "" {
			return fmt.Errorf("cannot create screen, no local remote found")
		}
		newWindowId := txCreateWindow(tx, sessionId, RemotePtrType{RemoteId: remoteId})
		maxScreenIdx := tx.GetInt(`SELECT COALESCE(max(screenidx), 0) FROM screen WHERE sessionid = ? AND NOT archived`, sessionId)
		var screenName string
		if origScreenName == "" {
			screenNames := tx.SelectStrings(`SELECT name FROM screen WHERE sessionid = ? AND NOT archived`, sessionId)
			screenName = fmtUniqueName("", "s%d", maxScreenIdx+1, screenNames)
		} else {
			screenName = origScreenName
		}
		newScreenId = scbase.GenPromptUUID()
		query = `INSERT INTO screen (sessionid, screenid, name, activewindowid, screenidx, screenopts, ownerid, sharemode, incognito, archived, archivedts) VALUES (?, ?, ?, ?, ?, ?, '', 'local', 0, 0, 0)`
		tx.Exec(query, sessionId, newScreenId, screenName, newWindowId, maxScreenIdx+1, ScreenOptsType{})
		layout := LayoutType{Type: LayoutFull}
		query = `INSERT INTO screen_window (sessionid, screenid, windowid, name, layout, selectedline, anchor, focustype) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		tx.Exec(query, sessionId, newScreenId, newWindowId, DefaultScreenWindowName, layout, 0, SWAnchorType{}, "input")
		if activate {
			query = `UPDATE session SET activescreenid = ? WHERE sessionid = ?`
			tx.Exec(query, newScreenId, sessionId)
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	newScreen, err := GetScreenById(ctx, sessionId, newScreenId)
	if err != nil {
		return nil, err
	}
	bareSession, err := GetBareSessionById(ctx, sessionId)
	if err != nil {
		return nil, err
	}
	bareSession.Screens = append(bareSession.Screens, newScreen)
	return ModelUpdate{Sessions: []*SessionType{bareSession}}, nil
}

func GetScreenById(ctx context.Context, sessionId string, screenId string) (*ScreenType, error) {
	var rtnScreen *ScreenType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM screen WHERE sessionid = ? AND screenid = ?`
		var screen ScreenType
		found := tx.Get(&screen, query, sessionId, screenId)
		if !found {
			return nil
		}
		rtnScreen = &screen
		query = `SELECT * FROM screen_window WHERE sessionid = ? AND screenid = ?`
		tx.Select(&screen.Windows, query, sessionId, screenId)
		screen.Full = true
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtnScreen, nil
}

func txCreateWindow(tx *TxWrap, sessionId string, curRemote RemotePtrType) string {
	w := &WindowType{
		SessionId:   sessionId,
		WindowId:    scbase.GenPromptUUID(),
		CurRemote:   curRemote,
		NextLineNum: 1,
		WinOpts:     WindowOptsType{},
		ShareMode:   ShareModeLocal,
		ShareOpts:   WindowShareOptsType{},
	}
	wmap := w.ToMap()
	query := `INSERT INTO window ( sessionid, windowid, curremoteownerid, curremoteid, curremotename, nextlinenum, winopts, ownerid, sharemode, shareopts) 
                          VALUES (:sessionid,:windowid,:curremoteownerid,:curremoteid,:curremotename,:nextlinenum,:winopts,:ownerid,:sharemode,:shareopts)`
	tx.NamedExec(query, wmap)
	return w.WindowId
}

func FindLineIdByArg(ctx context.Context, sessionId string, windowId string, lineArg string) (string, error) {
	var lineId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		lineNum, err := strconv.Atoi(lineArg)
		if err == nil {
			// valid linenum
			query := `SELECT lineid FROM line WHERE sessionid = ? AND windowid = ? AND linenum = ?`
			lineId = tx.GetString(query, sessionId, windowId, lineNum)
		} else if len(lineArg) == 8 {
			// prefix id string match
			query := `SELECT lineid FROM line WHERE sessionid = ? AND windowid = ? AND substr(lineid, 1, 8) = ?`
			lineId = tx.GetString(query, sessionId, windowId, lineArg)
		} else {
			// id match
			query := `SELECT lineid FROM line WHERE sessionid = ? AND windowid = ? AND lineid = ?`
			lineId = tx.GetString(query, sessionId, windowId, lineArg)
		}
		return nil
	})
	if txErr != nil {
		return "", txErr
	}
	return lineId, nil
}

func GetLineCmdByLineId(ctx context.Context, sessionId string, windowId string, lineId string) (*LineType, *CmdType, error) {
	var lineRtn *LineType
	var cmdRtn *CmdType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("window not found")
		}
		var lineVal LineType
		query = `SELECT * FROM line WHERE sessionid = ? AND windowid = ? AND lineid = ?`
		found := tx.Get(&lineVal, query, sessionId, windowId, lineId)
		if !found {
			return nil
		}
		lineRtn = &lineVal
		if lineVal.CmdId != "" {
			query = `SELECT * FROM cmd WHERE sessionid = ? AND cmdid = ?`
			m := tx.GetMap(query, sessionId, lineVal.CmdId)
			cmdRtn = CmdFromMap(m)
		}
		return nil
	})
	if txErr != nil {
		return nil, nil, txErr
	}
	return lineRtn, cmdRtn, nil
}

func GetLineCmdByCmdId(ctx context.Context, sessionId string, windowId string, cmdId string) (*LineType, *CmdType, error) {
	var lineRtn *LineType
	var cmdRtn *CmdType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("window not found")
		}
		var lineVal LineType
		query = `SELECT * FROM line WHERE sessionid = ? AND windowid = ? AND cmdid = ?`
		found := tx.Get(&lineVal, query, sessionId, windowId, cmdId)
		if !found {
			return nil
		}
		lineRtn = &lineVal
		query = `SELECT * FROM cmd WHERE sessionid = ? AND cmdid = ?`
		m := tx.GetMap(query, sessionId, cmdId)
		cmdRtn = CmdFromMap(m)
		return nil
	})
	if txErr != nil {
		return nil, nil, txErr
	}
	return lineRtn, cmdRtn, nil
}

func InsertLine(ctx context.Context, line *LineType, cmd *CmdType) error {
	if line == nil {
		return fmt.Errorf("line cannot be nil")
	}
	if line.LineId == "" {
		return fmt.Errorf("line must have lineid set")
	}
	if line.LineNum != 0 {
		return fmt.Errorf("line should not hage linenum set")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, line.SessionId, line.WindowId) {
			return fmt.Errorf("window not found, cannot insert line[%s/%s]", line.SessionId, line.WindowId)
		}
		query = `SELECT nextlinenum FROM window WHERE sessionid = ? AND windowid = ?`
		nextLineNum := tx.GetInt(query, line.SessionId, line.WindowId)
		line.LineNum = int64(nextLineNum)
		query = `INSERT INTO line  ( sessionid, windowid, userid, lineid, ts, linenum, linenumtemp, linelocal, linetype, text, cmdid, renderer, ephemeral, contentheight, star, archived, bookmarked, pinned)
                            VALUES (:sessionid,:windowid,:userid,:lineid,:ts,:linenum,:linenumtemp,:linelocal,:linetype,:text,:cmdid,:renderer,:ephemeral,:contentheight,:star,:archived,:bookmarked,:pinned)`
		tx.NamedExec(query, line)
		query = `UPDATE window SET nextlinenum = ? WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, nextLineNum+1, line.SessionId, line.WindowId)
		if cmd != nil {
			cmd.OrigTermOpts = cmd.TermOpts
			cmdMap := cmd.ToMap()
			query = `
INSERT INTO cmd  ( sessionid, cmdid, remoteownerid, remoteid, remotename, cmdstr, festate, statebasehash, statediffhasharr, termopts, origtermopts, status, startpk, doneinfo, rtnstate, runout, rtnbasehash, rtndiffhasharr)
          VALUES (:sessionid,:cmdid,:remoteownerid,:remoteid,:remotename,:cmdstr,:festate,:statebasehash,:statediffhasharr,:termopts,:origtermopts,:status,:startpk,:doneinfo,:rtnstate,:runout,:rtnbasehash,:rtndiffhasharr)
`
			tx.NamedExec(query, cmdMap)
		}
		return nil
	})
}

func GetCmdById(ctx context.Context, sessionId string, cmdId string) (*CmdType, error) {
	var cmd *CmdType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM cmd WHERE sessionid = ? AND cmdid = ?`
		m := tx.GetMap(query, sessionId, cmdId)
		cmd = CmdFromMap(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return cmd, nil
}

func HasDoneInfo(ctx context.Context, ck base.CommandKey) (bool, error) {
	var found bool
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		found = tx.Exists(`SELECT sessionid FROM cmd WHERE sessionid = ? AND cmdid = ? AND doneinfo is NOT NULL`, ck.GetSessionId(), ck.GetCmdId())
		return nil
	})
	if txErr != nil {
		return false, txErr
	}
	return found, nil
}

func UpdateCmdDoneInfo(ctx context.Context, ck base.CommandKey, doneInfo *CmdDoneInfo) (*ModelUpdate, error) {
	if doneInfo == nil {
		return nil, fmt.Errorf("invalid cmddone packet")
	}
	if ck.IsEmpty() {
		return nil, fmt.Errorf("cannot update cmddoneinfo, empty ck")
	}
	var rtnCmd *CmdType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ?, doneinfo = ? WHERE sessionid = ? AND cmdid = ?`
		tx.Exec(query, CmdStatusDone, quickJson(doneInfo), ck.GetSessionId(), ck.GetCmdId())
		var err error
		rtnCmd, err = GetCmdById(tx.Context(), ck.GetSessionId(), ck.GetCmdId())
		if err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	if rtnCmd == nil {
		return nil, fmt.Errorf("cmd data not found for ck[%s]", ck)
	}
	return &ModelUpdate{Cmd: rtnCmd}, nil
}

func UpdateCmdRtnState(ctx context.Context, ck base.CommandKey, statePtr ShellStatePtr) error {
	if ck.IsEmpty() {
		return fmt.Errorf("cannot update cmdrtnstate, empty ck")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET rtnbasehash = ?, rtndiffhasharr = ? WHERE sessionid = ? AND cmdid = ?`
		tx.Exec(query, statePtr.BaseHash, quickJsonArr(statePtr.DiffHashArr), ck.GetSessionId(), ck.GetCmdId())
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func AppendCmdErrorPk(ctx context.Context, errPk *packet.CmdErrorPacketType) error {
	if errPk == nil || errPk.CK.IsEmpty() {
		return fmt.Errorf("invalid cmderror packet (no ck)")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET runout = json_insert(runout, '$[#]', ?) WHERE sessionid = ? AND cmdid = ?`
		tx.Exec(query, quickJson(errPk), errPk.CK.GetSessionId(), errPk.CK.GetCmdId())
		return nil
	})
}

func ReInitFocus(ctx context.Context) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE screen_window SET focustype = 'input'`
		tx.Exec(query)
		return nil
	})
}

func HangupAllRunningCmds(ctx context.Context) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ? WHERE status = ?`
		tx.Exec(query, CmdStatusHangup, CmdStatusRunning)
		return nil
	})
}

func HangupRunningCmdsByRemoteId(ctx context.Context, remoteId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ? WHERE status = ? AND remoteid = ?`
		tx.Exec(query, CmdStatusHangup, CmdStatusRunning, remoteId)
		return nil
	})
}

func HangupCmd(ctx context.Context, ck base.CommandKey) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ? WHERE sessionid = ? AND cmdid = ?`
		tx.Exec(query, CmdStatusHangup, ck.GetSessionId(), ck.GetCmdId())
		return nil
	})
}

func getNextId(ids []string, delId string) string {
	if len(ids) == 0 {
		return ""
	}
	if len(ids) == 1 {
		if ids[0] == delId {
			return ""
		}
		return ids[0]
	}
	for idx := 0; idx < len(ids); idx++ {
		if ids[idx] == delId {
			var rtnIdx int
			if idx == len(ids)-1 {
				rtnIdx = idx - 1
			} else {
				rtnIdx = idx + 1
			}
			return ids[rtnIdx]
		}
	}
	return ids[0]
}

func SwitchScreenById(ctx context.Context, sessionId string, screenId string) (UpdatePacket, error) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ?`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("cannot switch to screen, screen=%s does not exist in session=%s", screenId, sessionId)
		}
		query = `UPDATE session SET activescreenid = ? WHERE sessionid = ?`
		tx.Exec(query, screenId, sessionId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	bareSession, err := GetBareSessionById(ctx, sessionId)
	if err != nil {
		return nil, err
	}
	return ModelUpdate{Sessions: []*SessionType{bareSession}}, nil
}

func cleanSessionCmds(ctx context.Context, sessionId string) error {
	var removedCmds []string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT cmdid FROM cmd WHERE sessionid = ? AND cmdid NOT IN (SELECT cmdid FROM line WHERE sessionid = ?)`
		removedCmds = tx.SelectStrings(query, sessionId, sessionId)
		query = `DELETE FROM cmd WHERE sessionid = ? AND cmdid NOT IN (SELECT cmdid FROM line WHERE sessionid = ?)`
		tx.Exec(query, sessionId, sessionId)
		query = `DELETE FROM bookmark_cmd WHERE sessionid = ? AND cmdid NOT IN (SELECT cmdid FROM cmd WHERE sessionid = ?)`
		tx.Exec(query, sessionId, sessionId)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	for _, cmdId := range removedCmds {
		DeletePtyOutFile(ctx, sessionId, cmdId)
	}
	return nil
}

func CleanWindows(sessionId string) {
	// NOTE: context.Background() here! (this could take a long time, and is async)
	txErr := WithTx(context.Background(), func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid NOT IN (SELECT windowid FROM screen_window WHERE sessionid = ?)`
		removedWindowIds := tx.SelectStrings(query, sessionId, sessionId)
		if len(removedWindowIds) == 0 {
			return nil
		}
		for _, windowId := range removedWindowIds {
			query = `DELETE FROM window WHERE sessionid = ? AND windowid = ?`
			tx.Exec(query, sessionId, windowId)
			query = `DELETE FROM history WHERE sessionid = ? AND windowid = ?`
			tx.Exec(query, sessionId, windowId)
			query = `DELETE FROM line WHERE sessionid = ? AND windowid = ?`
			tx.Exec(query, sessionId, windowId)
		}
		return cleanSessionCmds(tx.Context(), sessionId)
	})
	if txErr != nil {
		fmt.Printf("ERROR cleaning windows sessionid:%s: %v\n", sessionId, txErr)
	}
}

func ArchiveScreen(ctx context.Context, sessionId string, screenId string) (UpdatePacket, error) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ?`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("cannot close screen (not found)")
		}
		query = `SELECT archived FROM screen WHERE sessionid = ? AND screenid = ?`
		closeVal := tx.GetBool(query, sessionId, screenId)
		if closeVal {
			return nil
		}
		query = `SELECT count(*) FROM screen WHERE sessionid = ? AND NOT archived`
		numScreens := tx.GetInt(query, sessionId)
		if numScreens <= 1 {
			return fmt.Errorf("cannot archive the last screen in a session")
		}
		query = `UPDATE screen SET archived = 1, archivedts = ?, screenidx = 0 WHERE sessionid = ? AND screenid = ?`
		tx.Exec(query, time.Now().UnixMilli(), sessionId, screenId)
		isActive := tx.Exists(`SELECT sessionid FROM session WHERE sessionid = ? AND activescreenid = ?`, sessionId, screenId)
		if isActive {
			screenIds := tx.SelectStrings(`SELECT screenid FROM screen WHERE sessionid = ? AND NOT archived ORDER BY screenidx`, sessionId)
			nextId := getNextId(screenIds, screenId)
			tx.Exec(`UPDATE session SET activescreenid = ? WHERE sessionid = ?`, nextId, sessionId)
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	bareSession, err := GetBareSessionById(ctx, sessionId)
	if err != nil {
		return nil, txErr
	}
	update := ModelUpdate{Sessions: []*SessionType{bareSession}}
	newScreen, _ := GetScreenById(ctx, sessionId, screenId)
	if newScreen != nil {
		bareSession.Screens = append(bareSession.Screens, newScreen)
	}
	return update, nil
}

func UnArchiveScreen(ctx context.Context, sessionId string, screenId string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ? AND archived`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("cannot re-open screen (not found or not archived)")
		}
		maxScreenIdx := tx.GetInt(`SELECT COALESCE(max(screenidx), 0) FROM screen WHERE sessionid = ? AND NOT archived`, sessionId)
		query = `UPDATE screen SET archived = 0, screenidx = ? WHERE sessionid = ? AND screenid = ?`
		tx.Exec(query, maxScreenIdx+1, sessionId, screenId)
		return nil
	})
	return txErr
}

func DeleteScreen(ctx context.Context, sessionId string, screenId string) (UpdatePacket, error) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ?`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("cannot purge screen (not found)")
		}
		query = `SELECT count(*) FROM screen WHERE sessionid = ? AND NOT archived`
		numScreens := tx.GetInt(query, sessionId)
		if numScreens <= 1 {
			return fmt.Errorf("cannot purge the last screen in a session")
		}
		isActive := tx.Exists(`SELECT sessionid FROM session WHERE sessionid = ? AND activescreenid = ?`, sessionId, screenId)
		if isActive {
			screenIds := tx.SelectStrings(`SELECT screenid FROM screen WHERE sessionid = ? AND NOT archived ORDER BY screenidx`, sessionId)
			nextId := getNextId(screenIds, screenId)
			tx.Exec(`UPDATE session SET activescreenid = ? WHERE sessionid = ?`, nextId, sessionId)
		}
		query = `DELETE FROM screen_window WHERE sessionid = ? AND screenid = ?`
		tx.Exec(query, sessionId, screenId)
		query = `DELETE FROM screen WHERE sessionid = ? AND screenid = ?`
		tx.Exec(query, sessionId, screenId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	go CleanWindows(sessionId)
	bareSession, err := GetBareSessionById(ctx, sessionId)
	if err != nil {
		return nil, err
	}
	bareSession.Screens = append(bareSession.Screens, &ScreenType{SessionId: sessionId, ScreenId: screenId, Remove: true})
	update := ModelUpdate{Sessions: []*SessionType{bareSession}}
	return update, nil
}

func GetRemoteState(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType) (*packet.ShellState, *ShellStatePtr, error) {
	ssptr, err := GetRemoteStatePtr(ctx, sessionId, windowId, remotePtr)
	if err != nil {
		return nil, nil, err
	}
	if ssptr == nil {
		return nil, nil, nil
	}
	state, err := GetFullState(ctx, *ssptr)
	if err != nil {
		return nil, nil, err
	}
	return state, ssptr, err
}

func GetRemoteStatePtr(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType) (*ShellStatePtr, error) {
	var ssptr *ShellStatePtr
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		ri, err := GetRemoteInstance(tx.Context(), sessionId, windowId, remotePtr)
		if err != nil {
			return err
		}
		if ri == nil {
			return nil
		}
		ssptr = &ShellStatePtr{ri.StateBaseHash, ri.StateDiffHashArr}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return ssptr, nil
}

func validateSessionWindow(tx *TxWrap, sessionId string, windowId string) error {
	if windowId == "" {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("no session found")
		}
		return nil
	} else {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("no window found")
		}
		return nil
	}
}

func GetRemoteInstance(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType) (*RemoteInstance, error) {
	if remotePtr.IsSessionScope() {
		windowId = ""
	}
	var ri *RemoteInstance
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		m := tx.GetMap(query, sessionId, windowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		ri = RIFromMap(m)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return ri, nil
}

// internal function for UpdateRemoteState
func updateRIWithState(ctx context.Context, ri *RemoteInstance, stateBase *packet.ShellState, stateDiff *packet.ShellStateDiff) error {
	if stateBase != nil {
		ri.StateBaseHash = stateBase.GetHashVal(false)
		ri.StateDiffHashArr = nil
		err := StoreStateBase(ctx, stateBase)
		if err != nil {
			return err
		}
	} else if stateDiff != nil {
		ri.StateBaseHash = stateDiff.BaseHash
		ri.StateDiffHashArr = append(stateDiff.DiffHashArr, stateDiff.GetHashVal(false))
		err := StoreStateDiff(ctx, stateDiff)
		if err != nil {
			return err
		}
	}
	return nil
}

func UpdateRemoteState(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType, feState FeStateType, stateBase *packet.ShellState, stateDiff *packet.ShellStateDiff) (*RemoteInstance, error) {
	if stateBase == nil && stateDiff == nil {
		return nil, fmt.Errorf("UpdateRemoteState, must set state or diff")
	}
	if stateBase != nil && stateDiff != nil {
		return nil, fmt.Errorf("UpdateRemoteState, cannot set state and diff")
	}
	if remotePtr.IsSessionScope() {
		windowId = ""
	}
	var ri *RemoteInstance
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		err := validateSessionWindow(tx, sessionId, windowId)
		if err != nil {
			return fmt.Errorf("cannot update remote instance state: %w", err)
		}
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		m := tx.GetMap(query, sessionId, windowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		ri = RIFromMap(m)
		if ri == nil {
			ri = &RemoteInstance{
				RIId:          scbase.GenPromptUUID(),
				Name:          remotePtr.Name,
				SessionId:     sessionId,
				WindowId:      windowId,
				RemoteOwnerId: remotePtr.OwnerId,
				RemoteId:      remotePtr.RemoteId,
				FeState:       feState,
			}
			err = updateRIWithState(tx.Context(), ri, stateBase, stateDiff)
			if err != nil {
				return err
			}
			query = `INSERT INTO remote_instance ( riid, name, sessionid, windowid, remoteownerid, remoteid, festate, statebasehash, statediffhasharr)
                                          VALUES (:riid,:name,:sessionid,:windowid,:remoteownerid,:remoteid,:festate,:statebasehash,:statediffhasharr)`
			tx.NamedExec(query, ri.ToMap())
			return nil
		} else {
			query = `UPDATE remote_instance SET festate = ?, statebasehash = ?, statediffhasharr = ? WHERE riid = ?`
			ri.FeState = feState
			err = updateRIWithState(tx.Context(), ri, stateBase, stateDiff)
			if err != nil {
				return err
			}
			tx.Exec(query, quickJson(ri.FeState), ri.StateBaseHash, quickJsonArr(ri.StateDiffHashArr), ri.RIId)
			return nil
		}
	})
	return ri, txErr
}

func UpdateCurRemote(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("cannot update curremote: no window found")
		}
		query = `UPDATE window SET curremoteownerid = ?, curremoteid = ?, curremotename = ? WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name, sessionId, windowId)
		return nil
	})
	return txErr
}

func reorderStrings(strs []string, toMove string, newIndex int) []string {
	if toMove == "" {
		return strs
	}
	var newStrs []string
	if newIndex < 0 {
		newStrs = append(newStrs, toMove)
	}
	for _, sval := range strs {
		if len(newStrs) == newIndex {
			newStrs = append(newStrs, toMove)
		}
		if sval != toMove {
			newStrs = append(newStrs, sval)
		}
	}
	if newIndex >= len(newStrs) {
		newStrs = append(newStrs, toMove)
	}
	return newStrs
}

func ReIndexSessions(ctx context.Context, sessionId string, newIndex int) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE NOT archived ORDER BY sessionidx, name, sessionid`
		ids := tx.SelectStrings(query)
		if sessionId != "" {
			ids = reorderStrings(ids, sessionId, newIndex)
		}
		query = `UPDATE session SET sessionid = ? WHERE sessionid = ?`
		for idx, id := range ids {
			tx.Exec(query, id, idx+1)
		}
		return nil
	})
	return txErr
}

func SetSessionName(ctx context.Context, sessionId string, name string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("session does not exist")
		}
		query = `SELECT archived FROM session WHERE sessionid = ?`
		isArchived := tx.GetBool(query, sessionId)
		if !isArchived {
			query = `SELECT sessionid FROM session WHERE name = ? AND NOT archived`
			dupSessionId := tx.GetString(query, name)
			if dupSessionId == sessionId {
				return nil
			}
			if dupSessionId != "" {
				return fmt.Errorf("invalid duplicate session name '%s'", name)
			}
		}
		query = `UPDATE session SET name = ? WHERE sessionid = ?`
		tx.Exec(query, name, sessionId)
		return nil
	})
	return txErr
}

func SetScreenName(ctx context.Context, sessionId string, screenId string, name string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ?`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("screen does not exist")
		}
		query = `UPDATE screen SET name = ? WHERE sessionid = ? AND screenid = ?`
		tx.Exec(query, name, sessionId, screenId)
		return nil
	})
	return txErr
}

func SetScreenOpts(ctx context.Context, sessionId string, screenId string, opts *ScreenOptsType) error {
	if opts == nil {
		return fmt.Errorf("invalid screen opts cannot be nil")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ?`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("screen does not exist")
		}
		query = `UPDATE screen SET screenopts = ? WHERE sessionid = ? AND screenid = ?`
		tx.Exec(query, opts, sessionId, screenId)
		return nil
	})
	return txErr
}

func ArchiveWindowLines(ctx context.Context, sessionId string, windowId string) (*ModelUpdate, error) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("window does not exist")
		}
		query = `UPDATE line SET archived = 1 WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, sessionId, windowId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	win, err := GetWindowById(ctx, sessionId, windowId)
	if err != nil {
		return nil, err
	}
	return &ModelUpdate{Windows: []*WindowType{win}}, nil
}

func PurgeWindowLines(ctx context.Context, sessionId string, windowId string) (*ModelUpdate, error) {
	var lineIds []string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("window does not exist")
		}
		query = `SELECT lineid FROM line WHERE sessionid = ? AND windowid = ?`
		lineIds = tx.SelectStrings(query, sessionId, windowId)
		query = `DELETE FROM line WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, sessionId, windowId)
		query = `DELETE FROM history WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, sessionId, windowId)
		query = `UPDATE window SET nextlinenum = 1 WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, sessionId, windowId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	go cleanSessionCmds(context.Background(), sessionId)
	win, err := GetWindowById(ctx, sessionId, windowId)
	if err != nil {
		return nil, err
	}
	for _, lineId := range lineIds {
		line := &LineType{
			SessionId: sessionId,
			WindowId:  windowId,
			LineId:    lineId,
			Remove:    true,
		}
		win.Lines = append(win.Lines, line)
	}
	return &ModelUpdate{Windows: []*WindowType{win}}, nil
}

func GetRunningWindowCmds(ctx context.Context, sessionId string, windowId string) ([]*CmdType, error) {
	var rtn []*CmdType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * from cmd WHERE cmdid IN (SELECT cmdid FROM line WHERE sessionid = ? AND windowid = ?) AND status = ?`
		cmdMaps := tx.SelectMaps(query, sessionId, windowId, CmdStatusRunning)
		for _, m := range cmdMaps {
			rtn = append(rtn, CmdFromMap(m))
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func UpdateCmdTermOpts(ctx context.Context, sessionId string, cmdId string, termOpts TermOpts) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET termopts = ? WHERE sessionid = ? AND cmdid = ?`
		tx.Exec(query, termOpts, sessionId, cmdId)
		return nil
	})
	return txErr
}

// returns riids of deleted RIs
func WindowReset(ctx context.Context, sessionId string, windowId string) ([]*RemoteInstance, error) {
	var delRis []*RemoteInstance
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("window does not exist")
		}
		query = `SELECT riid FROM remote_instance WHERE sessionid = ? AND windowid = ?`
		riids := tx.SelectStrings(query, sessionId, windowId)
		for _, riid := range riids {
			ri := &RemoteInstance{SessionId: sessionId, WindowId: windowId, RIId: riid, Remove: true}
			delRis = append(delRis, ri)
		}
		query = `DELETE FROM remote_instance WHERE sessionid = ? AND windowid = ?`
		tx.Exec(query, sessionId, windowId)
		return nil
	})
	return delRis, txErr
}

func DeleteSession(ctx context.Context, sessionId string) (UpdatePacket, error) {
	var newActiveSessionId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("session does not exist")
		}
		query = `DELETE FROM session WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM screen WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM screen_window WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM window WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM history WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM line WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM cmd WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		query = `DELETE FROM bookmark_cmd WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		newActiveSessionId, _ = fixActiveSessionId(tx.Context())
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	delErr := DeleteSessionDir(ctx, sessionId)
	update := ModelUpdate{}
	if newActiveSessionId != "" {
		update.ActiveSessionId = newActiveSessionId
	}
	if delErr != nil {
		update.Info = &InfoMsgType{
			InfoMsg: fmt.Sprintf("error removing session files: %v", delErr),
		}
	}
	update.Sessions = append(update.Sessions, &SessionType{SessionId: sessionId, Remove: true})
	return update, nil
}

func fixActiveSessionId(ctx context.Context) (string, error) {
	var newActiveSessionId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		curActiveSessionId := tx.GetString("SELECT activesessionid FROM client")
		query := `SELECT sessionid FROM session WHERE sessionid = ? AND NOT archived`
		if tx.Exists(query, curActiveSessionId) {
			return nil
		}
		var err error
		newActiveSessionId, err = GetFirstSessionId(tx.Context())
		if err != nil {
			return err
		}
		tx.Exec("UPDATE client SET activesessionid = ?", newActiveSessionId)
		return nil
	})
	if txErr != nil {
		return "", txErr
	}
	return newActiveSessionId, nil
}

func ArchiveSession(ctx context.Context, sessionId string) (*ModelUpdate, error) {
	if sessionId == "" {
		return nil, fmt.Errorf("invalid blank sessionid")
	}
	var newActiveSessionId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("session does not exist")
		}
		query = `SELECT archived FROM session WHERE sessionid = ?`
		isArchived := tx.GetBool(query, sessionId)
		if isArchived {
			return nil
		}
		query = `UPDATE session SET archived = 1, archivedts = ? WHERE sessionid = ?`
		tx.Exec(query, time.Now().UnixMilli(), sessionId)
		newActiveSessionId, _ = fixActiveSessionId(tx.Context())
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	bareSession, _ := GetBareSessionById(ctx, sessionId)
	update := &ModelUpdate{}
	if bareSession != nil {
		update.Sessions = append(update.Sessions, bareSession)
	}
	if newActiveSessionId != "" {
		update.ActiveSessionId = newActiveSessionId
	}
	return update, nil
}

func UnArchiveSession(ctx context.Context, sessionId string, activate bool) (*ModelUpdate, error) {
	if sessionId == "" {
		return nil, fmt.Errorf("invalid blank sessionid")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("session does not exist")
		}
		query = `SELECT archived FROM session WHERE sessionid = ?`
		isArchived := tx.GetBool(query, sessionId)
		if !isArchived {
			return nil
		}
		query = `UPDATE session SET archived = 0, archivedts = 0 WHERE sessionid = ?`
		tx.Exec(query, sessionId)
		if activate {
			query = `UPDATE client SET activesessionid = ?`
			tx.Exec(query, sessionId)
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	bareSession, _ := GetBareSessionById(ctx, sessionId)
	update := &ModelUpdate{}
	if bareSession != nil {
		update.Sessions = append(update.Sessions, bareSession)
	}
	if activate {
		update.ActiveSessionId = sessionId
	}
	return update, nil
}

func GetSessionStats(ctx context.Context, sessionId string) (*SessionStatsType, error) {
	rtn := &SessionStatsType{SessionId: sessionId}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("not found")
		}
		query = `SELECT count(*) FROM screen WHERE sessionid = ? AND NOT archived`
		rtn.NumScreens = tx.GetInt(query, sessionId)
		query = `SELECT count(*) FROM screen WHERE sessionid = ? AND archived`
		rtn.NumArchivedScreens = tx.GetInt(query, sessionId)
		query = `SELECT count(*) FROM window WHERE sessionid = ?`
		rtn.NumWindows = tx.GetInt(query, sessionId)
		query = `SELECT count(*) FROM line WHERE sessionid = ?`
		rtn.NumLines = tx.GetInt(query, sessionId)
		query = `SELECT count(*) FROM cmd WHERE sessionid = ?`
		rtn.NumCmds = tx.GetInt(query, sessionId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	diskSize, err := SessionDiskSize(sessionId)
	if err != nil {
		return nil, err
	}
	rtn.DiskStats = diskSize
	return rtn, nil
}

const (
	RemoteField_Alias       = "alias"       // string
	RemoteField_ConnectMode = "connectmode" // string
	RemoteField_AutoInstall = "autoinstall" // bool
	RemoteField_SSHKey      = "sshkey"      // string
	RemoteField_SSHPassword = "sshpassword" // string
	RemoteField_Color       = "color"       // string
)

// editMap: alias, connectmode, autoinstall, sshkey, color, sshpassword (from constants)
func UpdateRemote(ctx context.Context, remoteId string, editMap map[string]interface{}) (*RemoteType, error) {
	var rtn *RemoteType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT remoteid FROM remote WHERE remoteid = ?`
		if !tx.Exists(query, remoteId) {
			return fmt.Errorf("remote not found")
		}
		if alias, found := editMap[RemoteField_Alias]; found {
			query = `SELECT remoteid FROM remote WHERE remotealias = ? AND remoteid <> ?`
			if alias != "" && tx.Exists(query, alias, remoteId) {
				return fmt.Errorf("remote has duplicate alias, cannot update")
			}
			query = `UPDATE remote SET remotealias = ? WHERE remoteid = ?`
			tx.Exec(query, alias, remoteId)
		}
		if mode, found := editMap[RemoteField_ConnectMode]; found {
			query = `UPDATE remote SET connectmode = ? WHERE remoteid = ?`
			tx.Exec(query, mode, remoteId)
		}
		if autoInstall, found := editMap[RemoteField_AutoInstall]; found {
			query = `UPDATE remote SET autoinstall = ? WHERE remoteid = ?`
			tx.Exec(query, autoInstall, remoteId)
		}
		if sshKey, found := editMap[RemoteField_SSHKey]; found {
			query = `UPDATE remote SET sshopts = json_set(sshopts, '$.sshidentity', ?) WHERE remoteid = ?`
			tx.Exec(query, sshKey, remoteId)
		}
		if sshPassword, found := editMap[RemoteField_SSHPassword]; found {
			query = `UPDATE remote SET sshopts = json_set(sshopts, '$.sshpassword', ?) WHERE remoteid = ?`
			tx.Exec(query, sshPassword, remoteId)
		}
		if color, found := editMap[RemoteField_Color]; found {
			query = `UPDATE remote SET remoteopts = json_set(remoteopts, '$.color', ?) WHERE remoteid = ?`
			tx.Exec(query, color, remoteId)
		}
		var err error
		rtn, err = GetRemoteById(tx.Context(), remoteId)
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

const (
	SWField_AnchorLine   = "anchorline"   // int
	SWField_AnchorOffset = "anchoroffset" // int
	SWField_SelectedLine = "selectedline" // int
	SWField_Focus        = "focustype"    // string
)

func UpdateScreenWindow(ctx context.Context, sessionId string, screenId string, windowId string, editMap map[string]interface{}) (*ScreenWindowType, error) {
	var rtn *ScreenWindowType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM screen_window WHERE sessionid = ? AND screenid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, screenId, windowId) {
			return fmt.Errorf("screen-window not found")
		}
		if anchorLine, found := editMap[SWField_AnchorLine]; found {
			query = `UPDATE screen_window SET anchor = json_set(anchor, '$.anchorline', ?) WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.Exec(query, anchorLine, sessionId, screenId, windowId)
		}
		if anchorOffset, found := editMap[SWField_AnchorOffset]; found {
			query = `UPDATE screen_window SET anchor = json_set(anchor, '$.anchoroffset', ?) WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.Exec(query, anchorOffset, sessionId, screenId, windowId)
		}
		if sline, found := editMap[SWField_SelectedLine]; found {
			query = `UPDATE screen_window SET selectedline = ? WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.Exec(query, sline, sessionId, screenId, windowId)
		}
		if focusType, found := editMap[SWField_Focus]; found {
			query = `UPDATE screen_window SET focustype = ? WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.Exec(query, focusType, sessionId, screenId, windowId)
		}
		var sw ScreenWindowType
		query = `SELECT * FROM screen_window WHERE sessionid = ? AND screenid = ? AND windowid = ?`
		found := tx.Get(&sw, query, sessionId, screenId, windowId)
		if found {
			rtn = &sw
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetScreenWindowByIds(ctx context.Context, sessionId string, screenId string, windowId string) (*ScreenWindowType, error) {
	var rtn *ScreenWindowType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var sw ScreenWindowType
		query := `SELECT * FROM screen_window WHERE sessionid = ? AND screenid = ? AND windowid = ?`
		found := tx.Get(&sw, query, sessionId, screenId, windowId)
		if found {
			rtn = &sw
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetLineResolveItems(ctx context.Context, sessionId string, windowId string) ([]ResolveItem, error) {
	var rtn []ResolveItem
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT lineid as id, linenum as num FROM line WHERE sessionid = ? AND windowid = ? ORDER BY linenum`
		tx.Select(&rtn, query, sessionId, windowId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func UpdateSWsWithCmdFg(ctx context.Context, sessionId string, cmdId string) ([]*ScreenWindowType, error) {
	var rtn []*ScreenWindowType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid, screenid, windowid 
                  FROM screen_window sw 
                  WHERE 
                    sessionid = ?
                    AND focustype = 'cmd-fg' 
                    AND selectedline IN (SELECT linenum 
                                         FROM line l 
                                         WHERE l.sessionid = sw.sessionid 
                                           AND l.windowid = sw.windowid 
                                           AND l.cmdid = ?
                                        )`
		var swKeys []SWKey
		tx.Select(&swKeys, query, sessionId, cmdId)
		if len(swKeys) == 0 {
			return nil
		}
		for _, key := range swKeys {
			editMap := make(map[string]interface{})
			editMap[SWField_Focus] = SWFocusInput
			sw, err := UpdateScreenWindow(tx.Context(), key.SessionId, key.ScreenId, key.WindowId, editMap)
			if err != nil {
				return err
			}
			rtn = append(rtn, sw)
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func StoreStateBase(ctx context.Context, state *packet.ShellState) error {
	stateBase := &StateBase{
		Version: state.Version,
		Ts:      time.Now().UnixMilli(),
	}
	stateBase.BaseHash, stateBase.Data = state.EncodeAndHash()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT basehash FROM state_base WHERE basehash = ?`
		if tx.Exists(query, stateBase.BaseHash) {
			return nil
		}
		query = `INSERT INTO state_base (basehash, ts, version, data) VALUES (:basehash,:ts,:version,:data)`
		tx.NamedExec(query, stateBase)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func StoreStateDiff(ctx context.Context, diff *packet.ShellStateDiff) error {
	stateDiff := &StateDiff{
		BaseHash:    diff.BaseHash,
		Ts:          time.Now().UnixMilli(),
		DiffHashArr: diff.DiffHashArr,
	}
	stateDiff.DiffHash, stateDiff.Data = diff.EncodeAndHash()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT basehash FROM state_base WHERE basehash = ?`
		if stateDiff.BaseHash == "" || !tx.Exists(query, stateDiff.BaseHash) {
			return fmt.Errorf("cannot store statediff, basehash:%s does not exist", stateDiff.BaseHash)
		}
		query = `SELECT diffhash FROM state_diff WHERE diffhash = ?`
		for idx, diffHash := range stateDiff.DiffHashArr {
			if !tx.Exists(query, diffHash) {
				return fmt.Errorf("cannot store statediff, diffhash[%d]:%s does not exist", idx, diffHash)
			}
		}
		if tx.Exists(query, stateDiff.DiffHash) {
			return nil
		}
		query = `INSERT INTO state_diff (diffhash, ts, basehash, diffhasharr, data) VALUES (:diffhash,:ts,:basehash,:diffhasharr,:data)`
		tx.NamedExec(query, stateDiff.ToMap())
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

// returns error when not found
func GetFullState(ctx context.Context, ssPtr ShellStatePtr) (*packet.ShellState, error) {
	var state *packet.ShellState
	if ssPtr.BaseHash == "" {
		return nil, fmt.Errorf("invalid empty basehash")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var stateBase StateBase
		query := `SELECT * FROM state_base WHERE basehash = ?`
		found := tx.Get(&stateBase, query, ssPtr.BaseHash)
		if !found {
			return fmt.Errorf("ShellState %s not found", ssPtr.BaseHash)
		}
		state = &packet.ShellState{}
		err := state.DecodeShellState(stateBase.Data)
		if err != nil {
			return err
		}
		for idx, diffHash := range ssPtr.DiffHashArr {
			query = `SELECT * FROM state_diff WHERE diffhash = ?`
			m := tx.GetMap(query, diffHash)
			stateDiff := StateDiffFromMap(m)
			if stateDiff == nil {
				return fmt.Errorf("ShellStateDiff %s not found", diffHash)
			}
			var ssDiff packet.ShellStateDiff
			err = ssDiff.DecodeShellStateDiff(stateDiff.Data)
			if err != nil {
				return err
			}
			newState, err := shexec.ApplyShellStateDiff(*state, ssDiff)
			if err != nil {
				return fmt.Errorf("GetFullState, diff[%d]:%s: %v", idx, diffHash, err)
			}
			state = &newState
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	if state == nil {
		return nil, fmt.Errorf("ShellState not found")
	}
	return state, nil
}

func UpdateLineStar(ctx context.Context, lineId string, starVal int) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE line SET star = ? WHERE lineid = ?`
		tx.Exec(query, starVal, lineId)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func UpdateLineHeight(ctx context.Context, lineId string, heightVal int) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE line SET contentheight = ? WHERE lineid = ?`
		tx.Exec(query, heightVal, lineId)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

// can return nil, nil if line is not found
func GetLineById(ctx context.Context, sessionId string, windowId string, lineId string) (*LineType, error) {
	var rtn *LineType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var line LineType
		query := `SELECT * FROM line WHERE sessionid = ? AND windowid = ? AND lineid = ?`
		found := tx.Get(&line, query, sessionId, windowId, lineId)
		if found {
			rtn = &line
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func SetLineArchivedById(ctx context.Context, lineId string, archived bool) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE line SET archived = ? WHERE lineid = ?`
		tx.Exec(query, archived, lineId)
		return nil
	})
	return txErr
}

func purgeCmdById(ctx context.Context, sessionId string, cmdId string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE FROM cmd WHERE sessionid = ? AND cmdid = ?`
		tx.Exec(query, sessionId, cmdId)
		return DeletePtyOutFile(tx.Context(), sessionId, cmdId)
	})
	return txErr
}

func PurgeLineById(ctx context.Context, sessionId string, lineId string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT cmdid FROM line WHERE sessionid = ? AND lineid = ?`
		cmdId := tx.GetString(query, sessionId, lineId)
		query = `DELETE FROM line WHERE sessionid = ? AND lineid = ?`
		tx.Exec(query, sessionId, lineId)
		query = `DELETE FROM history WHERE sessionid = ? AND lineid = ?`
		tx.Exec(query, sessionId, lineId)
		if cmdId != "" {
			query = `SELECT count(*) FROM line WHERE sessionid = ? AND cmdid = ?`
			cmdRefCount := tx.GetInt(query, sessionId, cmdId)
			if cmdRefCount == 0 {
				err := purgeCmdById(tx.Context(), sessionId, cmdId)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	return txErr
}

func GetRIsForWindow(ctx context.Context, sessionId string, windowId string) ([]*RemoteInstance, error) {
	var rtn []*RemoteInstance
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND (windowid = '' OR windowid = ?)`
		riMaps := tx.SelectMaps(query, sessionId, windowId)
		for _, m := range riMaps {
			ri := RIFromMap(m)
			if ri != nil {
				rtn = append(rtn, ri)
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetCurDayStr() string {
	now := time.Now()
	dayStr := now.Format("2006-01-02")
	return dayStr
}

func UpdateCurrentActivity(ctx context.Context, update ActivityUpdate) error {
	now := time.Now()
	dayStr := GetCurDayStr()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var tdata TelemetryData
		query := `SELECT tdata FROM activity WHERE day = ?`
		found := tx.Get(&tdata, query, dayStr)
		if !found {
			query = `INSERT INTO activity (day, uploaded, tdata, tzname, tzoffset, clientversion, clientarch)
                                   VALUES (?,   0,        ?,     ?,      ?,        ?,             ?)`
			tzName, tzOffset := now.Zone()
			if len(tzName) > MaxTzNameLen {
				tzName = tzName[0:MaxTzNameLen]
			}
			tx.Exec(query, dayStr, tdata, tzName, tzOffset, scbase.PromptVersion, scbase.ClientArch())
		}
		tdata.NumCommands += update.NumCommands
		tdata.FgMinutes += update.FgMinutes
		tdata.ActiveMinutes += update.ActiveMinutes
		tdata.OpenMinutes += update.OpenMinutes
		tdata.ClickShared += update.ClickShared
		tdata.HistoryView += update.HistoryView
		tdata.BookmarksView += update.BookmarksView
		if update.NumConns > 0 {
			tdata.NumConns = update.NumConns
		}
		query = `UPDATE activity
                 SET tdata = ?,
                     clientversion = ?
                 WHERE day = ?`
		tx.Exec(query, tdata, scbase.PromptVersion, dayStr)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func GetNonUploadedActivity(ctx context.Context) ([]*ActivityType, error) {
	var rtn []*ActivityType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
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
	txErr := WithTx(ctx, func(tx *TxWrap) error {
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

func foundInStrArr(strs []string, s string) bool {
	for _, sval := range strs {
		if s == sval {
			return true
		}
	}
	return false
}

// newPos is 0-indexed
func reorderStrs(strs []string, toMove string, newPos int) []string {
	if !foundInStrArr(strs, toMove) {
		return strs
	}
	var added bool
	rtn := make([]string, 0, len(strs))
	for _, s := range strs {
		if s == toMove {
			continue
		}
		if len(rtn) == newPos {
			added = true
			rtn = append(rtn, toMove)
		}
		rtn = append(rtn, s)
	}
	if !added {
		rtn = append(rtn, toMove)
	}
	return rtn
}

// newScreenIdx is 1-indexed
func SetScreenIdx(ctx context.Context, sessionId string, screenId string, newScreenIdx int) error {
	if newScreenIdx <= 0 {
		return fmt.Errorf("invalid screenidx/pos, must be greater than 0")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT screenid FROM screen WHERE sessionid = ? AND screenid = ? AND NOT archived`
		if !tx.Exists(query, sessionId, screenId) {
			return fmt.Errorf("invalid screen, not found (or archived)")
		}
		query = `SELECT screenid FROM screen WHERE sessionid = ? AND NOT archived ORDER BY screenidx`
		screens := tx.SelectStrings(query, sessionId)
		newScreens := reorderStrs(screens, screenId, newScreenIdx-1)
		query = `UPDATE screen SET screenidx = ? WHERE sessionid = ? AND screenid = ?`
		for idx, sid := range newScreens {
			tx.Exec(query, idx+1, sessionId, sid)
		}
		return nil
	})
	return txErr
}

func GetDBVersion(ctx context.Context) (int, error) {
	var version int
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT version FROM schema_migrations`
		version = tx.GetInt(query)
		return nil
	})
	return version, txErr
}

type bookmarkOrderType struct {
	BookmarkId string
	OrderIdx   int64
}

type bookmarkCmdType struct {
	BookmarkId string
	SessionId  string
	CmdId      string
}

func GetBookmarks(ctx context.Context, tag string) ([]*BookmarkType, error) {
	var bms []*BookmarkType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var query string
		var marr []map[string]interface{}
		if tag == "" {
			query = `SELECT * FROM bookmark`
			marr = tx.SelectMaps(query)
		} else {
			query = `SELECT * FROM bookmark WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`
			marr = tx.SelectMaps(query, tag)
		}
		bmMap := make(map[string]*BookmarkType)
		for _, m := range marr {
			bm := BookmarkFromMap(m)
			bms = append(bms, bm)
			bmMap[bm.BookmarkId] = bm
		}
		var orders []bookmarkOrderType
		query = `SELECT bookmarkid, orderidx FROM bookmark_order WHERE tag = ?`
		tx.Select(&orders, query, tag)
		for _, bmOrder := range orders {
			bm := bmMap[bmOrder.BookmarkId]
			if bm != nil {
				bm.OrderIdx = bmOrder.OrderIdx
			}
		}
		var cmds []bookmarkCmdType
		query = `SELECT bookmarkid, sessionid, cmdid FROM bookmark_cmd`
		tx.Select(&cmds, query)
		for _, cmd := range cmds {
			bm := bmMap[cmd.BookmarkId]
			if bm != nil {
				bm.Cmds = append(bm.Cmds, base.MakeCommandKey(cmd.SessionId, cmd.CmdId))
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return bms, nil
}

func GetBookmarkById(ctx context.Context, bookmarkId string, tag string) (*BookmarkType, error) {
	var rtn *BookmarkType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM bookmark WHERE bookmarkid = ?`
		m := tx.GetMap(query, bookmarkId)
		rtn = BookmarkFromMap(m)
		if rtn == nil {
			return nil
		}
		query = `SELECT orderidx FROM bookmark_order WHERE bookmarkid = ? AND tag = ?`
		orderIdx := tx.GetInt(query, bookmarkId, tag)
		rtn.OrderIdx = int64(orderIdx)
		query = `SELECT bookmarkid, sessionid, cmdid FROM bookmark_cmd WHERE bookmarkid = ?`
		var cmds []bookmarkCmdType
		tx.Select(&cmds, query, bookmarkId)
		for _, cmd := range cmds {
			rtn.Cmds = append(rtn.Cmds, base.MakeCommandKey(cmd.SessionId, cmd.CmdId))
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetBookmarkIdByArg(ctx context.Context, bookmarkArg string) (string, error) {
	var rtnId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		if len(bookmarkArg) == 8 {
			query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid LIKE (? || '%')`
			rtnId = tx.GetString(query, bookmarkArg)
			return nil
		}
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		rtnId = tx.GetString(query, bookmarkArg)
		return nil
	})
	if txErr != nil {
		return "", txErr
	}
	return rtnId, nil
}

// ignores OrderIdx field
func InsertBookmark(ctx context.Context, bm *BookmarkType) error {
	if bm == nil || bm.BookmarkId == "" {
		return fmt.Errorf("invalid empty bookmark id")
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		if tx.Exists(query, bm.BookmarkId) {
			return fmt.Errorf("bookmarkid already exists")
		}
		query = `INSERT INTO bookmark ( bookmarkid, createdts, cmdstr, alias, tags, description)
                               VALUES (:bookmarkid,:createdts,:cmdstr,:alias,:tags,:description)`
		tx.NamedExec(query, bm.ToMap())
		for _, tag := range append(bm.Tags, "") {
			query = `SELECT COALESCE(max(orderidx), 0) FROM bookmark_order WHERE tag = ?`
			maxOrder := tx.GetInt(query, tag)
			query = `INSERT INTO bookmark_order (tag, bookmarkid, orderidx) VALUES (?, ?, ?)`
			tx.Exec(query, tag, bm.BookmarkId, maxOrder+1)
		}
		query = `INSERT INTO bookmark_cmd (bookmarkid, sessionid, cmdid) VALUES (?, ?, ?)`
		for _, ck := range bm.Cmds {
			tx.Exec(query, bm.BookmarkId, ck.GetSessionId(), ck.GetCmdId())
		}
		query = `UPDATE line SET bookmarked = 1 WHERE sessionid = ? AND cmdid = ?`
		for _, ck := range bm.Cmds {
			tx.Exec(query, ck.GetSessionId(), ck.GetCmdId())
		}
		return nil
	})
	return txErr
}

const (
	BookmarkField_Desc   = "desc"
	BookmarkField_CmdStr = "cmdstr"
)

func EditBookmark(ctx context.Context, bookmarkId string, editMap map[string]interface{}) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		if !tx.Exists(query, bookmarkId) {
			return fmt.Errorf("bookmark not found")
		}
		if desc, found := editMap[BookmarkField_Desc]; found {
			query = `UPDATE bookmark SET description = ? WHERE bookmarkid = ?`
			tx.Exec(query, desc, bookmarkId)
		}
		if cmdStr, found := editMap[BookmarkField_CmdStr]; found {
			query = `UPDATE bookmark SET cmdstr = ? WHERE bookmarkid = ?`
			tx.Exec(query, cmdStr, bookmarkId)
		}
		return nil
	})
	return txErr
}

func fixupBookmarkOrder(tx *TxWrap) {
	query := `
WITH new_order AS (
  SELECT tag, bookmarkid, row_number() OVER (PARTITION BY tag ORDER BY orderidx) AS newidx FROM bookmark_order
)
UPDATE bookmark_order
SET orderidx = new_order.newidx
FROM new_order
WHERE bookmark_order.tag = new_order.tag AND bookmark_order.bookmarkid = new_order.bookmarkid
`
	tx.Exec(query)
}

func DeleteBookmark(ctx context.Context, bookmarkId string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		if !tx.Exists(query, bookmarkId) {
			return fmt.Errorf("bookmark not found")
		}
		query = `DELETE FROM bookmark WHERE bookmarkid = ?`
		tx.Exec(query, bookmarkId)
		query = `DELETE FROM bookmark_order WHERE bookmarkid = ?`
		tx.Exec(query, bookmarkId)
		query = `UPDATE line SET bookmarked = 0 WHERE bookmarked AND cmdid <> '' AND (sessionid||cmdid) IN (SELECT sessionid||cmdid FROM bookmark_cmd WHERE bookmarkid = ?) `
		tx.Exec(query, bookmarkId)
		query = `DELETE FROM bookmark_cmd WHERE bookmarkid = ?`
		tx.Exec(query, bookmarkId)
		fixupBookmarkOrder(tx)
		return nil
	})
	return txErr
}
