package sstore

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

func NumSessions(ctx context.Context) (int, error) {
	db, err := GetDB()
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

func GetRemoteByName(ctx context.Context, remoteName string) (*RemoteType, error) {
	var remote *RemoteType
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT * FROM remote WHERE remotename = ?`
		m := tx.GetMap(query, remoteName)
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

func InsertRemote(ctx context.Context, remote *RemoteType) error {
	if remote == nil {
		return fmt.Errorf("cannot insert nil remote")
	}
	db, err := GetDB()
	if err != nil {
		return err
	}
	query := `INSERT INTO remote ( remoteid, remotetype, remotename, autoconnect, initpk, sshopts, lastconnectts) VALUES 
                                 (:remoteid,:remotetype,:remotename,:autoconnect,:initpk,:sshopts,:lastconnectts)`
	_, err = db.NamedExec(query, remote.ToMap())
	if err != nil {
		return err
	}
	return nil
}

func GetAllSessions(ctx context.Context) ([]*SessionType, error) {
	db, err := GetDB()
	if err != nil {
		return nil, err
	}
	var rtn []*SessionType
	query := `SELECT * FROM session`
	err = db.SelectContext(ctx, &rtn, query)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func GetSessionById(ctx context.Context, id string) (*SessionType, error) {
	var rtnSession *SessionType
	err := WithTx(ctx, func(tx *TxWrap) error {
		var session SessionType
		query := `SELECT * FROM session WHERE sessionid = ?`
		found := tx.GetWrap(&session, query, id)
		if !found {
			return nil
		}
		rtnSession = &session
		query = `SELECT sessionid, windowid, name, curremote, version FROM window WHERE sessionid = ?`
		tx.SelectWrap(&session.Windows, query, session.SessionId)
		query = `SELECT * FROM remote_instance WHERE sessionid = ?`
		tx.SelectWrap(&session.Remotes, query, session.SessionId)
		query = `SELECT * FROM cmd WHERE sessionid = ?`
		marr := tx.SelectMaps(query, session.SessionId)
		for _, m := range marr {
			session.Cmds = append(session.Cmds, CmdFromMap(m))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rtnSession, nil
}

func GetSessionByName(ctx context.Context, name string) (*SessionType, error) {
	db, err := GetDB()
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

func GetWindowById(ctx context.Context, sessionId string, windowId string) (*WindowType, error) {
	var rtnWindow *WindowType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var window WindowType
		query := `SELECT * FROM window WHERE sessionid = ? AND windowid = ?`
		found := tx.GetWrap(&window, query, sessionId, windowId)
		if !found {
			return nil
		}
		rtnWindow = &window
		query = `SELECT * FROM line WHERE sessionid = ? AND windowid = ?`
		tx.SelectWrap(&window.Lines, query, sessionId, windowId)
		return nil
	})
	return rtnWindow, txErr
}

// also creates default window, returns sessionId
// if sessionName == "", it will be generated
func InsertSessionWithName(ctx context.Context, sessionName string) (string, error) {
	newSessionId := uuid.New().String()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		if sessionName == "" {
			var names []string
			query := `SELECT name FROM session`
			tx.GetWrap(&names, query)
			snum := len(names) + 1
			for {
				sessionName = fmt.Sprintf("session-%d", snum)
				if !containsStr(names, sessionName) {
					break
				}
				snum++
			}
		} else {
			var dupSessionId string
			query := `SELECT sessionid FROM session WHERE name = ?`
			tx.GetWrap(&dupSessionId, query, sessionName)
			if dupSessionId != "" {
				return fmt.Errorf("cannot create session with duplicate name")
			}
		}
		newSession := &SessionType{
			SessionId: newSessionId,
			Name:      sessionName,
		}
		query := `INSERT INTO session (sessionid, name) VALUES (:sessionid, :name)`
		tx.NamedExecWrap(query, newSession)
		window := &WindowType{
			SessionId: newSessionId,
			WindowId:  uuid.New().String(),
			Name:      DefaultWindowName,
			CurRemote: LocalRemoteName,
		}
		query = `INSERT INTO window (sessionid, windowid, name, curremote, version) VALUES (:sessionid, :windowid, :name, :curremote, :version)`
		tx.NamedExecWrap(query, window)
		return nil
	})
	return newSessionId, txErr
}

func containsStr(strs []string, testStr string) bool {
	for _, s := range strs {
		if s == testStr {
			return true
		}
	}
	return false
}

// if windowName == "", it will be generated
// returns (windowid, err)
func InsertWindow(ctx context.Context, sessionId string, windowName string) (string, error) {
	var newWindowId string
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		var testSessionId string
		query := `SELECT sesssionid FROM session WHERE sessionid = ?`
		sessionExists := tx.GetWrap(&testSessionId, query, sessionId)
		if !sessionExists {
			return fmt.Errorf("cannot insert window, session does not exist")
		}
		if windowName == "" {
			var names []string
			query = `SELECT name FROM window WHERE sessionid = ?`
			tx.GetWrap(&names, query, sessionId)
			wnum := len(names) + 1
			for {
				windowName = fmt.Sprintf("w%d", wnum)
				if !containsStr(names, windowName) {
					break
				}
				wnum++
			}
		} else {
			var testWindowId string
			query = `SELECT windowid FROM window WHERE sessionid = ? AND name = ?`
			windowExists := tx.GetWrap(&testWindowId, query, sessionId, windowName)
			if windowExists {
				return fmt.Errorf("cannot insert window, name already exists in session")
			}
		}
		newWindowId = uuid.New().String()
		window := &WindowType{
			SessionId: sessionId,
			WindowId:  newWindowId,
			Name:      windowName,
			CurRemote: LocalRemoteName,
		}
		query = `INSERT INTO window (sessionid, windowid, name, curremote, version) VALUES (:sessionid, :windowid, :name, :curremote, :version)`
		tx.NamedExecWrap(query, window)
		return nil
	})
	return newWindowId, txErr
}

func InsertLine(ctx context.Context, line *LineType, cmd *CmdType) error {
	if line == nil {
		return fmt.Errorf("line cannot be nil")
	}
	if line.LineId != 0 {
		return fmt.Errorf("new line cannot have LineId set")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		var windowId string
		query := `SELECT windowid FROM window WHERE sessionid = ? AND windowid = ?`
		hasWindow := tx.GetWrap(&windowId, query, line.SessionId, line.WindowId)
		if !hasWindow {
			return fmt.Errorf("window not found, cannot insert line[%s/%s]", line.SessionId, line.WindowId)
		}
		var maxLineId int
		query = `SELECT COALESCE(max(lineid), 0) FROM line WHERE sessionid = ? AND windowid = ?`
		tx.GetWrap(&maxLineId, query, line.SessionId, line.WindowId)
		line.LineId = maxLineId + 1
		query = `INSERT INTO line  ( sessionid, windowid, lineid, ts, userid, linetype, text, cmdid)
                            VALUES (:sessionid,:windowid,:lineid,:ts,:userid,:linetype,:text,:cmdid)`
		tx.NamedExecWrap(query, line)
		if cmd != nil {
			cmdMap := cmd.ToMap()
			query = `
INSERT INTO cmd  ( sessionid, cmdid, remoteid, cmdstr, remotestate, termopts, status, startpk, donepk, runout)
          VALUES (:sessionid,:cmdid,:remoteid,:cmdstr,:remotestate,:termopts,:status,:startpk,:donepk,:runout)
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

func UpdateCmdDonePk(ctx context.Context, donePk *packet.CmdDonePacketType) error {
	if donePk == nil || donePk.CK.IsEmpty() {
		return fmt.Errorf("invalid cmddone packet (no ck)")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE cmd SET status = ?, donepk = ? WHERE sessionid = ? AND cmdid = ?`
		tx.ExecWrap(query, CmdStatusDone, quickJson(donePk), donePk.CK.GetSessionId(), donePk.CK.GetCmdId())
		return nil
	})
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
