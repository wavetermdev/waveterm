package sstore

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"
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

func GetWindowLines(ctx context.Context, sessionId string, windowId string) ([]*LineType, error) {
	var lines []*LineType
	db, err := GetDB()
	if err != nil {
		return nil, err
	}
	query := `SELECT * FROM line WHERE sessionid = ? AND windowid = ?`
	err = db.SelectContext(ctx, &lines, query, sessionId, windowId)
	if err != nil {
		return nil, err
	}
	return lines, nil
}

// also creates window
func InsertSessionWithName(ctx context.Context, sessionName string) error {
	if sessionName == "" {
		return fmt.Errorf("invalid session name '%s'", sessionName)
	}
	session := &SessionType{
		SessionId: uuid.New().String(),
		Name:      sessionName,
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `INSERT INTO session (sessionid, name) VALUES (:sessionid, :name)`
		tx.NamedExecWrap(query, session)

		window := &WindowType{
			SessionId: session.SessionId,
			WindowId:  uuid.New().String(),
			Name:      DefaultWindowName,
			CurRemote: LocalRemoteName,
		}
		query = `INSERT INTO window (sessionid, windowid, name, curremote, version) VALUES (:sessionid, :windowid, :name, :curremote, :version)`
		tx.NamedExecWrap(query, window)
		return nil
	})
}

func InsertLine(ctx context.Context, line *LineType) error {
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
		return nil
	})
}

func InsertCmd(ctx context.Context, cmd *CmdType) error {
	if cmd == nil {
		return fmt.Errorf("cmd cannot be nil")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		var sessionId string
		query := `SELECT sessionid FROM session WHERE sessionid = ?`
		hasSession := tx.GetWrap(&sessionId, query, cmd.SessionId)
		if !hasSession {
			return fmt.Errorf("session not found, cannot insert cmd")
		}
		cmdMap := cmd.ToMap()
		query = `
INSERT INTO cmd  ( sessionid, cmdid, remoteid, cmdstr, remotestate, termopts, status, startpk, donepk, runout)
          VALUES (:sessionid,:cmdid,:remoteid,:cmdstr,:remotestate,:termopts,:status,:startpk,:donepk,:runout)
`
		tx.NamedExecWrap(query, cmdMap)
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
