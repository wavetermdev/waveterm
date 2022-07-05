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

const remoteSelectCols = "rowid, remoteid, remotetype, remotename, autoconnect, sshhost, sshopts, sshidentity, sshuser, lastconnectts"

func GetAllRemotes(ctx context.Context) ([]*RemoteType, error) {
	db, err := GetDB()
	if err != nil {
		return nil, err
	}
	query := fmt.Sprintf(`SELECT %s FROM remote`, remoteSelectCols)
	var remoteArr []*RemoteType
	err = db.SelectContext(ctx, &remoteArr, query)
	if err != nil {
		return nil, err
	}
	return remoteArr, nil
}

func GetRemoteByName(ctx context.Context, remoteName string) (*RemoteType, error) {
	db, err := GetDB()
	if err != nil {
		return nil, err
	}
	query := fmt.Sprintf(`SELECT %s FROM remote WHERE remotename = ?`, remoteSelectCols)
	var remote RemoteType
	err = db.GetContext(ctx, &remote, query, remoteName)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &remote, nil
}

func GetRemoteById(ctx context.Context, remoteId string) (*RemoteType, error) {
	db, err := GetDB()
	if err != nil {
		return nil, err
	}
	query := fmt.Sprintf(`SELECT %s FROM remote WHERE remoteid = ?`, remoteSelectCols)
	var remote RemoteType
	err = db.GetContext(ctx, &remote, query, remoteId)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &remote, nil
}

func InsertRemote(ctx context.Context, remote *RemoteType) error {
	if remote == nil {
		return fmt.Errorf("cannot insert nil remote")
	}
	if remote.RowId != 0 {
		return fmt.Errorf("cannot insert a remote that already has rowid set, rowid=%d", remote.RowId)
	}
	db, err := GetDB()
	if err != nil {
		return err
	}
	query := `INSERT INTO remote ( remoteid, remotetype, remotename, autoconnect, sshhost, sshopts, sshidentity, sshuser, lastconnectts, ptyout) VALUES 
                                 (:remoteid,:remotetype,:remotename,:autoconnect,:sshhost,:sshopts,:sshidentity,:sshuser, 0            , '')`
	result, err := db.NamedExec(query, remote)
	if err != nil {
		return err
	}
	remote.RowId, err = result.LastInsertId()
	if err != nil {
		return fmt.Errorf("cannot get lastinsertid from insert remote: %w", err)
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
		query = `SELECT * FROM session_remote WHERE sessionid = ?`
		tx.SelectWrap(&session.Remotes, query, session.SessionId)
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

// also creates window, and sessionremote
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
		query = `SELECT max(lineid) FROM line WHERE sessionid = ? AND windowid = ?`
		tx.GetWrap(&maxLineId, query, line.SessionId, line.WindowId)
		line.LineId = maxLineId + 1
		query = `INSERT INTO line  ( sessionid, windowid, lineid, ts, userid, linetype, text, cmdid)
                            VALUES (:sessionid,:windowid,:lineid,:ts,:userid,:linetype,:text,:cmdid)`
		tx.NamedExecWrap(query, line)
		return nil
	})
}
