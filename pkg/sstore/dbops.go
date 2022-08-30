package sstore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const HistoryCols = "historyid, ts, userid, sessionid, screenid, windowid, lineid, cmdid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd"
const DefaultMaxHistoryItems = 1000

func NumSessions(ctx context.Context) (int, error) {
	db, err := GetDB(ctx)
	if err != nil {
		return 0, err
	}
	query := "SELECT count(*) FROM session"
	var count int
	err = db.GetContext(ctx, &count, query)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func GetAllRemotes(ctx context.Context) ([]*RemoteType, error) {
	var rtn []*RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote`
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

func InsertRemote(ctx context.Context, remote *RemoteType) error {
	if remote == nil {
		return fmt.Errorf("cannot insert nil remote")
	}
	db, err := GetDB(ctx)
	if err != nil {
		return err
	}
	query := `INSERT INTO remote ( remoteid, physicalid, remotetype, remotealias, remotecanonicalname, remotesudo, remoteuser, remotehost, connectmode, initpk, sshopts, remoteopts, lastconnectts) VALUES 
                                 (:remoteid,:physicalid,:remotetype,:remotealias,:remotecanonicalname,:remotesudo,:remoteuser,:remotehost,:connectmode,:initpk,:sshopts,:remoteopts,:lastconnectts)`
	_, err = db.NamedExec(query, remote.ToMap())
	if err != nil {
		return err
	}
	return nil
}

func InsertHistoryItem(ctx context.Context, hitem *HistoryItemType) error {
	if hitem == nil {
		return fmt.Errorf("cannot insert nil history item")
	}
	db, err := GetDB(ctx)
	if err != nil {
		return err
	}
	query := `INSERT INTO history ( historyid, ts, userid, sessionid, screenid, windowid, lineid, cmdid, haderror, cmdstr, remoteownerid, remoteid, remotename, ismetacmd) VALUES
                                  (:historyid,:ts,:userid,:sessionid,:screenid,:windowid,:lineid,:cmdid,:haderror,:cmdstr,:remoteownerid,:remoteid,:remotename,:ismetacmd)`
	_, err = db.NamedExec(query, hitem.ToMap())
	if err != nil {
		return err
	}
	return nil
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
		var ris []*RemoteInstance
		tx.SelectWrap(&ris, query)
		for _, ri := range ris {
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
		query = `SELECT * FROM line WHERE sessionid = ? AND windowid = ?`
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
	db, err := GetDB(ctx)
	if err != nil {
		return nil, err
	}
	var sessionId string
	query := `SELECT sessionid FROM session WHERE name = ?`
	err = db.GetContext(ctx, &sessionId, query, name)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return GetSessionById(ctx, sessionId)
}

// also creates default window, returns sessionId
// if sessionName == "", it will be generated
func InsertSessionWithName(ctx context.Context, sessionName string, activate bool) (UpdatePacket, error) {
	newSessionId := uuid.New().String()
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
		newScreenId = uuid.New().String()
		query = `INSERT INTO screen (sessionid, screenid, name, activewindowid, screenidx, screenopts, ownerid, sharemode) VALUES (?, ?, ?, ?, ?, ?, '', 'local')`
		tx.ExecWrap(query, sessionId, newScreenId, screenName, newWindowId, maxScreenIdx+1, ScreenOptsType{})
		layout := LayoutType{Type: LayoutFull}
		query = `INSERT INTO screen_window (sessionid, screenid, windowid, name, layout) VALUES (?, ?, ?, ?, ?)`
		tx.ExecWrap(query, sessionId, newScreenId, newWindowId, DefaultScreenWindowName, layout)
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
		SessionId: sessionId,
		WindowId:  uuid.New().String(),
		CurRemote: curRemote,
		WinOpts:   WindowOptsType{},
		ShareMode: ShareModeLocal,
		ShareOpts: WindowShareOptsType{},
	}
	wmap := w.ToMap()
	query := `INSERT INTO window ( sessionid, windowid, curremoteownerid, curremoteid, curremotename, winopts, ownerid, sharemode, shareopts) 
                          VALUES (:sessionid,:windowid,:curremoteownerid,:curremoteid,:curremotename,:winopts,:ownerid,:sharemode,:shareopts)`
	tx.NamedExecWrap(query, wmap)
	return w.WindowId
}

func InsertLine(ctx context.Context, line *LineType, cmd *CmdType) error {
	if line == nil {
		return fmt.Errorf("line cannot be nil")
	}
	if line.LineId == "" {
		return fmt.Errorf("line must have lineid set")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		var windowId string
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		hasWindow := tx.GetWrap(&windowId, query, line.SessionId, line.WindowId)
		if !hasWindow {
			return fmt.Errorf("window not found, cannot insert line[%s/%s]", line.SessionId, line.WindowId)
		}
		query = `INSERT INTO line  ( sessionid, windowid, lineid, ts, userid, linetype, text, cmdid, ephemeral)
                            VALUES (:sessionid,:windowid,:lineid,:ts,:userid,:linetype,:text,:cmdid,:ephemeral)`
		tx.NamedExecWrap(query, line)
		if cmd != nil {
			cmdMap := cmd.ToMap()
			query = `
INSERT INTO cmd  ( sessionid, cmdid, remoteownerid, remoteid, remotename, cmdstr, remotestate, termopts, status, startpk, donepk, runout, usedrows)
          VALUES (:sessionid,:cmdid,:remoteownerid,:remoteid,:remotename,:cmdstr,:remotestate,:termopts,:status,:startpk,:donepk,:runout,:usedrows)
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

func UpdateCmdDonePk(ctx context.Context, donePk *packet.CmdDonePacketType) (UpdatePacket, error) {
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
	return ModelUpdate{Cmd: rtnCmd}, nil
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

func GetRemoteState(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType) (*RemoteState, error) {
	var remoteState *RemoteState
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var ri RemoteInstance
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		found := tx.GetWrap(&ri, query, sessionId, windowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		if found {
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

func UpdateRemoteState(ctx context.Context, sessionId string, windowId string, remotePtr RemotePtrType, state RemoteState) (*RemoteInstance, error) {
	if remotePtr.IsSessionScope() {
		windowId = ""
	}
	var ri RemoteInstance
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		err := validateSessionWindow(tx, sessionId, windowId)
		if err != nil {
			return fmt.Errorf("cannot update remote instance cwd: %w", err)
		}
		query := `SELECT * FROM remote_instance WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		found := tx.GetWrap(&ri, query, sessionId, windowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		if !found {
			ri = RemoteInstance{
				RIId:          uuid.New().String(),
				Name:          remotePtr.Name,
				SessionId:     sessionId,
				WindowId:      windowId,
				RemoteOwnerId: remotePtr.OwnerId,
				RemoteId:      remotePtr.RemoteId,
				State:         state,
			}
			query = `INSERT INTO remote_instance ( riid, name, sessionid, windowid, remoteownerid, remoteid, state) 
                                          VALUES (:riid,:name,:sessionid,:windowid,:remoteownerid,:remoteid,:state)`
			tx.NamedExecWrap(query, ri)
			return nil
		}
		query = `UPDATE remote_instance SET state = ? WHERE sessionid = ? AND windowid = ? AND remoteownerid = ? AND remoteid = ? AND name = ?`
		ri.State = state
		tx.ExecWrap(query, ri.State, ri.SessionId, ri.WindowId, remotePtr.OwnerId, remotePtr.RemoteId, remotePtr.Name)
		return nil
	})
	return &ri, txErr
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
