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

func GetRemoteByName(ctx context.Context, remoteName string) (*RemoteType, error) {
	db, err := GetDB()
	if err != nil {
		return nil, err
	}
	query := `SELECT rowid, remoteid, remotetype, remotename, hostname, connectopts, lastconnectts FROM remote WHERE remotename = ?`
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
	query := `SELECT rowid, remoteid, remotetype, remotename, hostname, connectopts, lastconnectts FROM remote WHERE remoteid = ?`
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
	query := `INSERT INTO remote (remoteid, remotetype, remotename, hostname, connectopts, lastconnectts, ptyout) VALUES (:remoteid, :remotetype, :remotename, :hostname, :connectopts, 0, '')`
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
	db, err := GetDB()
	query := `SELECT * FROM session WHERE sessionid = ?`
	var session SessionType
	err = db.GetContext(ctx, &session, query, id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func GetSessionByName(ctx context.Context, name string) (*SessionType, error) {
	db, err := GetDB()
	query := `SELECT * FROM session WHERE name = ?`
	var session SessionType
	err = db.GetContext(ctx, &session, query, name)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
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
	localRemote, err := GetRemoteByName(ctx, LocalRemoteName)
	if err != nil {
		return err
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

		sr := &SessionRemote{
			SessionId:  session.SessionId,
			WindowId:   window.WindowId,
			RemoteName: localRemote.RemoteName,
			RemoteId:   localRemote.RemoteId,
			Cwd:        DefaultCwd,
		}
		query = `INSERT INTO session_remote (sessionid, windowid, remotename, remoteid, cwd) VALUES (:sessionid, :windowid, :remotename, :remoteid, :cwd)`
		tx.NamedExecWrap(query, sr)
		return nil
	})
}
