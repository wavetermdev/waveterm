package sstore

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

const HistoryCols = "historyid, ts, userid, sessionid, screenid, windowid, lineid, cmdid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd"
const DefaultMaxHistoryItems = 1000

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
			tx.ExecWrap(`DELETE FROM remote WHERE remoteid = ?`, r.RemoteId)
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
            ( remoteid, physicalid, remotetype, remotealias, remotecanonicalname, remotesudo, remoteuser, remotehost, connectmode, autoinstall, initpk, sshopts, remoteopts, lastconnectts, archived, remoteidx, local) VALUES
            (:remoteid,:physicalid,:remotetype,:remotealias,:remotecanonicalname,:remotesudo,:remoteuser,:remotehost,:connectmode,:autoinstall,:initpk,:sshopts,:remoteopts,:lastconnectts,:archived,:remoteidx,:local)`
		tx.NamedExecWrap(query, r.ToMap())
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
                  ( historyid, ts, userid, sessionid, screenid, windowid, lineid, cmdid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd) VALUES
                  (:historyid,:ts,:userid,:sessionid,:screenid,:windowid,:lineid,:cmdid,:haderror,:cmdstr,:remoteownerid,:remoteid,:remotename,:ismetacmd)`
		tx.NamedExecWrap(query, hitem.ToMap())
		return nil
	})
	return txErr
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

func GetBareSessions(ctx context.Context) ([]*SessionType, error) {
	var rtn []*SessionType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM session ORDER BY sessionidx`
		tx.SelectWrap(&rtn, query)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func GetAllSessionIds(ctx context.Context) ([]string, error) {
	var rtn []string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid from session ORDER by sessionidx`
		rtn = tx.SelectStrings(query)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetBareSessionById(ctx context.Context, sessionId string) (*SessionType, error) {
	var rtn SessionType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM session WHERE sessionid = ?`
		tx.GetWrap(&rtn, query, sessionId)
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
		query := `SELECT * FROM session`
		tx.SelectWrap(&rtn, query)
		sessionMap := make(map[string]*SessionType)
		for _, session := range rtn {
			sessionMap[session.SessionId] = session
			session.Full = true
		}
		var screens []*ScreenType
		query = `SELECT * FROM screen ORDER BY screenidx`
		tx.SelectWrap(&screens, query)
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
		tx.SelectWrap(&sws, query)
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
		tx.SelectWrap(&rtnWindow.Lines, query, sessionId, windowId)
		query = `SELECT * FROM cmd WHERE cmdid IN (SELECT cmdid FROM line WHERE sessionid = ? AND windowid = ?)`
		cmdMaps := tx.SelectMaps(query, sessionId, windowId)
		for _, m := range cmdMaps {
			rtnWindow.Cmds = append(rtnWindow.Cmds, CmdFromMap(m))
		}
		return nil
	})
	return rtnWindow, err
}

func GetSessionScreens(ctx context.Context, sessionId string) ([]*ScreenType, error) {
	var rtn []*ScreenType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM screen WHERE sessionid = ? ORDER BY screenidx`
		tx.SelectWrap(&rtn, query, sessionId)
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
	newSessionId := scbase.GenSCUUID()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		names := tx.SelectStrings(`SELECT name FROM session`)
		sessionName = fmtUniqueName(sessionName, "session-%d", len(names)+1, names)
		maxSessionIdx := tx.GetInt(`SELECT COALESCE(max(sessionidx), 0) FROM session`)
		query := `INSERT INTO session (sessionid, name, activescreenid, sessionidx, notifynum, ownerid, sharemode, accesskey) VALUES (?, ?, '', ?, ?, '', 'local', '')`
		tx.ExecWrap(query, newSessionId, sessionName, maxSessionIdx+1, 0)
		_, err := InsertScreen(tx.Context(), newSessionId, "", true)
		if err != nil {
			return err
		}
		if activate {
			query = `UPDATE client SET activesessionid = ?`
			tx.ExecWrap(query, newSessionId)
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
		tx.ExecWrap(query, sessionId)
		return nil
	})
	return txErr
}

func SetWinSize(ctx context.Context, winSize ClientWinSizeType) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE client SET winsize = ?`
		tx.ExecWrap(query, quickJson(winSize))
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
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("cannot create screen, no session found")
		}
		remoteId := tx.GetString(`SELECT remoteid FROM remote WHERE remotealias = ?`, LocalRemoteAlias)
		if remoteId == "" {
			return fmt.Errorf("cannot create screen, no local remote found")
		}
		newWindowId := txCreateWindow(tx, sessionId, RemotePtrType{RemoteId: remoteId})
		maxScreenIdx := tx.GetInt(`SELECT COALESCE(max(screenidx), 0) FROM screen WHERE sessionid = ?`, sessionId)
		screenNames := tx.SelectStrings(`SELECT name FROM screen WHERE sessionid = ?`, sessionId)
		screenName := fmtUniqueName(origScreenName, "s%d", maxScreenIdx+1, screenNames)
		newScreenId = scbase.GenSCUUID()
		query = `INSERT INTO screen (sessionid, screenid, name, activewindowid, screenidx, screenopts, ownerid, sharemode) VALUES (?, ?, ?, ?, ?, ?, '', 'local')`
		tx.ExecWrap(query, sessionId, newScreenId, screenName, newWindowId, maxScreenIdx+1, ScreenOptsType{})
		layout := LayoutType{Type: LayoutFull}
		query = `INSERT INTO screen_window (sessionid, screenid, windowid, name, layout, selectedline, anchor, focustype) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		tx.ExecWrap(query, sessionId, newScreenId, newWindowId, DefaultScreenWindowName, layout, 0, "", "input")
		if activate {
			query = `UPDATE session SET activescreenid = ? WHERE sessionid = ?`
			tx.ExecWrap(query, newScreenId, sessionId)
		}
		return nil
	})
	newScreen, err := GetScreenById(ctx, sessionId, newScreenId)
	if err != nil {
		return nil, err
	}
	update, session := MakeSingleSessionUpdate(sessionId)
	if activate {
		session.ActiveScreenId = newScreenId
	}
	session.Screens = append(session.Screens, newScreen)
	return update, txErr
}

func GetScreenById(ctx context.Context, sessionId string, screenId string) (*ScreenType, error) {
	var rtnScreen *ScreenType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM screen WHERE sessionid = ? AND screenid = ?`
		var screen ScreenType
		found := tx.GetWrap(&screen, query, sessionId, screenId)
		if !found {
			return nil
		}
		rtnScreen = &screen
		query = `SELECT * FROM screen_window WHERE sessionid = ? AND screenid = ?`
		tx.SelectWrap(&screen.Windows, query, sessionId, screenId)
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
		WindowId:    scbase.GenSCUUID(),
		CurRemote:   curRemote,
		NextLineNum: 1,
		WinOpts:     WindowOptsType{},
		ShareMode:   ShareModeLocal,
		ShareOpts:   WindowShareOptsType{},
	}
	wmap := w.ToMap()
	query := `INSERT INTO window ( sessionid, windowid, curremoteownerid, curremoteid, curremotename, nextlinenum, winopts, ownerid, sharemode, shareopts) 
                          VALUES (:sessionid,:windowid,:curremoteownerid,:curremoteid,:curremotename,:nextlinenum,:winopts,:ownerid,:sharemode,:shareopts)`
	tx.NamedExecWrap(query, wmap)
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
			query := `SELECT * FROM line WHERE sessionid = ? AND windowid = ? AND lineid = ?`
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
		found := tx.GetWrap(&lineVal, query, sessionId, windowId, lineId)
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
		found := tx.GetWrap(&lineVal, query, sessionId, windowId, cmdId)
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
		query = `INSERT INTO line  ( sessionid, windowid, userid, lineid, ts, linenum, linenumtemp, linelocal, linetype, text, cmdid, ephemeral, contentheight)
                            VALUES (:sessionid,:windowid,:userid,:lineid,:ts,:linenum,:linenumtemp,:linelocal,:linetype,:text,:cmdid,:ephemeral,:contentheight)`
		tx.NamedExecWrap(query, line)
		query = `UPDATE window SET nextlinenum = ? WHERE sessionid = ? AND windowid = ?`
		tx.ExecWrap(query, nextLineNum+1, line.SessionId, line.WindowId)
		if cmd != nil {
			cmd.OrigTermOpts = cmd.TermOpts
			cmdMap := cmd.ToMap()
			query = `
INSERT INTO cmd  ( sessionid, cmdid, remoteownerid, remoteid, remotename, cmdstr, remotestate, termopts, origtermopts, status, startpk, donepk, rtnstate, runout)
          VALUES (:sessionid,:cmdid,:remoteownerid,:remoteid,:remotename,:cmdstr,:remotestate,:termopts,:origtermopts,:status,:startpk,:donepk,:rtnstate,:runout)
`
			tx.NamedExecWrap(query, cmdMap)
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

func UpdateCmdDonePk(ctx context.Context, donePk *packet.CmdDonePacketType) (*ModelUpdate, error) {
	if donePk == nil || donePk.CK.IsEmpty() {
		return nil, fmt.Errorf("invalid cmddone packet (no ck)")
	}
	var rtnCmd *CmdType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ?, donepk = ? WHERE sessionid = ? AND cmdid = ?`
		tx.ExecWrap(query, CmdStatusDone, quickJson(donePk), donePk.CK.GetSessionId(), donePk.CK.GetCmdId())
		var err error
		rtnCmd, err = GetCmdById(tx.Context(), donePk.CK.GetSessionId(), donePk.CK.GetCmdId())
		if err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	if rtnCmd == nil {
		return nil, fmt.Errorf("cmd data not found for ck[%s]", donePk.CK)
	}
	return &ModelUpdate{Cmd: rtnCmd}, nil
}

func AppendCmdErrorPk(ctx context.Context, errPk *packet.CmdErrorPacketType) error {
	if errPk == nil || errPk.CK.IsEmpty() {
		return fmt.Errorf("invalid cmderror packet (no ck)")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET runout = json_insert(runout, '$[#]', ?) WHERE sessionid = ? AND cmdid = ?`
		tx.ExecWrap(query, quickJson(errPk), errPk.CK.GetSessionId(), errPk.CK.GetCmdId())
		return nil
	})
}

func HangupAllRunningCmds(ctx context.Context) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ? WHERE status = ?`
		tx.ExecWrap(query, CmdStatusHangup, CmdStatusRunning)
		return nil
	})
}

func HangupRunningCmdsByRemoteId(ctx context.Context, remoteId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ? WHERE status = ? AND remoteid = ?`
		tx.ExecWrap(query, CmdStatusHangup, CmdStatusRunning, remoteId)
		return nil
	})
}

func getNextId(ids []string, delId string) string {
	fmt.Printf("getnextid %v | %v\n", ids, delId)
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
		tx.ExecWrap(query, screenId, sessionId)
		return nil
	})
	update, session := MakeSingleSessionUpdate(sessionId)
	session.ActiveScreenId = screenId
	return update, txErr
}

func CleanWindows() {
}

func DeleteScreen(ctx context.Context, sessionId string, screenId string) (UpdatePacket, error) {
	var newActiveScreenId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		isActive := tx.Exists(`SELECT sessionid FROM session WHERE sessionid = ? AND activescreenid = ?`, sessionId, screenId)
		fmt.Printf("delete-screen %s %s | %v\n", sessionId, screenId, isActive)
		if isActive {
			screenIds := tx.SelectStrings(`SELECT screenid FROM screen WHERE sessionid = ? ORDER BY screenidx`, sessionId)
			nextId := getNextId(screenIds, screenId)
			tx.ExecWrap(`UPDATE session SET activescreenid = ? WHERE sessionid = ?`, nextId, sessionId)
			newActiveScreenId = nextId
		}
		query := `DELETE FROM screen_window WHERE sessionid = ? AND screenid = ?`
		tx.ExecWrap(query, sessionId, screenId)
		query = `DELETE FROM screen WHERE sessionid = ? AND screenid = ?`
		tx.ExecWrap(query, sessionId, screenId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	go CleanWindows()
	update, session := MakeSingleSessionUpdate(sessionId)
	session.ActiveScreenId = newActiveScreenId
	session.Screens = append(session.Screens, &ScreenType{SessionId: sessionId, ScreenId: screenId, Remove: true})
	return update, nil
}

func GetRemoteState(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType) (*packet.ShellState, error) {
	var remoteState *packet.ShellState
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		m := tx.GetMap(query, sessionId, windowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		ri := RIFromMap(m)
		if ri != nil {
			remoteState = &ri.State
			return nil
		}
		return nil
	})
	return remoteState, txErr
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

func UpdateRemoteState(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType, state packet.ShellState) (*RemoteInstance, error) {
	if remotePtr.IsSessionScope() {
		windowId = ""
	}
	var ri *RemoteInstance
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		err := validateSessionWindow(tx, sessionId, windowId)
		if err != nil {
			return fmt.Errorf("cannot update remote instance cwd: %w", err)
		}
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		m := tx.GetMap(query, sessionId, windowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		ri = RIFromMap(m)
		if ri == nil {
			ri = &RemoteInstance{
				RIId:          scbase.GenSCUUID(),
				Name:          remotePtr.Name,
				SessionId:     sessionId,
				WindowId:      windowId,
				RemoteOwnerId: remotePtr.OwnerId,
				RemoteId:      remotePtr.RemoteId,
				State:         state,
			}
			query = `INSERT INTO remote_instance ( riid, name, sessionid, windowid, remoteownerid, remoteid, state) 
                                          VALUES (:riid,:name,:sessionid,:windowid,:remoteownerid,:remoteid,:state)`
			tx.NamedExecWrap(query, ri.ToMap())
			return nil
		}
		query = `UPDATE remote_instance SET state = ? WHERE riid = ?`
		ri.State = state
		tx.ExecWrap(query, quickJson(ri.State), ri.RIId)
		return nil
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
		tx.ExecWrap(query, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name, sessionId, windowId)
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
		query := `SELECT sessionid FROM session ORDER BY sessionidx, name, sessionid`
		ids := tx.SelectStrings(query)
		if sessionId != "" {
			ids = reorderStrings(ids, sessionId, newIndex)
		}
		query = `UPDATE session SET sessionid = ? WHERE sessionid = ?`
		for idx, id := range ids {
			tx.ExecWrap(query, id, idx+1)
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
		query = `SELECT sessionid FROM session WHERE name = ?`
		dupSessionId := tx.GetString(query, name)
		if dupSessionId == sessionId {
			return nil
		}
		if dupSessionId != "" {
			return fmt.Errorf("invalid duplicate session name '%s'", name)
		}
		query = `UPDATE session SET name = ? WHERE sessionid = ?`
		tx.ExecWrap(query, name, sessionId)
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
		query = `SELECT screenid FROM screen WHERE sessionid = ? AND name = ?`
		dupScreenId := tx.GetString(query, sessionId, name)
		if dupScreenId == screenId {
			return nil
		}
		if dupScreenId != "" {
			return fmt.Errorf("invalid duplicate screen name '%s'", name)
		}
		query = `UPDATE screen SET name = ? WHERE sessionid = ? AND screenid = ?`
		tx.ExecWrap(query, name, sessionId, screenId)
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
		tx.ExecWrap(query, opts, sessionId, screenId)
		return nil
	})
	return txErr
}

func ClearWindow(ctx context.Context, sessionId string, windowId string) (*ModelUpdate, error) {
	var lineIds []string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		if !tx.Exists(query, sessionId, windowId) {
			return fmt.Errorf("window does not exist")
		}
		query = `SELECT lineid FROM line WHERE sessionid = ? AND windowid = ?`
		lineIds = tx.SelectStrings(query, sessionId, windowId)
		query = `DELETE FROM line WHERE sessionid = ? AND windowid = ?`
		tx.ExecWrap(query, sessionId, windowId)
		query = `UPDATE window SET nextlinenum = 1 WHERE sessionid = ? AND windowid = ?`
		tx.ExecWrap(query, sessionId, windowId)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
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
	return &ModelUpdate{Window: win}, nil
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
		tx.ExecWrap(query, termOpts, sessionId, cmdId)
		return nil
	})
	return txErr
}

func DeleteSession(ctx context.Context, sessionId string) error {
	return nil
}

func GetSessionStats(ctx context.Context, sessionId string) (*SessionStatsType, error) {
	rtn := &SessionStatsType{SessionId: sessionId}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		if !tx.Exists(query, sessionId) {
			return fmt.Errorf("not found")
		}
		query = `SELECT count(*) FROM screen WHERE sessionid = ?`
		rtn.NumScreens = tx.GetInt(query, sessionId)
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
			tx.ExecWrap(query, alias, remoteId)
		}
		if mode, found := editMap[RemoteField_ConnectMode]; found {
			query = `UPDATE remote SET connectmode = ? WHERE remoteid = ?`
			tx.ExecWrap(query, mode, remoteId)
		}
		if autoInstall, found := editMap[RemoteField_AutoInstall]; found {
			query = `UPDATE remote SET autoinstall = ? WHERE remoteid = ?`
			tx.ExecWrap(query, autoInstall, remoteId)
		}
		if sshKey, found := editMap[RemoteField_SSHKey]; found {
			query = `UPDATE remote SET sshopts = json_set(sshopts, '$.sshidentity', ?) WHERE remoteid = ?`
			tx.ExecWrap(query, sshKey, remoteId)
		}
		if sshPassword, found := editMap[RemoteField_SSHPassword]; found {
			query = `UPDATE remote SET sshopts = json_set(sshopts, '$.sshpassword', ?) WHERE remoteid = ?`
			tx.ExecWrap(query, sshPassword, remoteId)
		}
		if color, found := editMap[RemoteField_Color]; found {
			query = `UPDATE remote SET remoteopts = json_set(remoteopts, '$.color', ?) WHERE remoteid = ?`
			tx.ExecWrap(query, color, remoteId)
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
			tx.ExecWrap(query, anchorLine, sessionId, screenId, windowId)
		}
		if anchorOffset, found := editMap[SWField_AnchorOffset]; found {
			query = `UPDATE screen_window SET anchor = json_set(anchor, '$.anchoroffset', ?) WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.ExecWrap(query, anchorOffset, sessionId, screenId, windowId)
		}
		if sline, found := editMap[SWField_SelectedLine]; found {
			query = `UPDATE screen_window SET selectedline = ? WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.ExecWrap(query, sline, sessionId, screenId, windowId)
		}
		if focusType, found := editMap[SWField_Focus]; found {
			query = `UPDATE screen_window SET focustype = ? WHERE sessionid = ? AND screenid = ? AND windowid = ?`
			tx.ExecWrap(query, focusType, sessionId, screenId, windowId)
		}
		var sw ScreenWindowType
		query = `SELECT * FROM screen_window WHERE sessionid = ? AND screenid = ? AND windowid = ?`
		found := tx.GetWrap(&sw, query, sessionId, screenId, windowId)
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
		found := tx.GetWrap(&sw, query, sessionId, screenId, windowId)
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
		tx.SelectWrap(&rtn, query, sessionId, windowId)
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
		tx.SelectWrap(&swKeys, query, sessionId, cmdId)
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
