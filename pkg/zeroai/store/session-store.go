// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package store

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/jmoiron/sqlx"
	dbfs "github.com/wavetermdev/waveterm/db"
	"github.com/wavetermdev/waveterm/pkg/util/migrateutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const ZeroaiDBName = "zeroai.db"

var globalSessionDB *sqlx.DB

// InitSessionStore initializes the session store
func InitSessionStore() error {
	if globalSessionDB != nil {
		return nil
	}

	dbName := getDBName()
	rtn, err := sqlx.Open("sqlite3", dbName+"?mode=rwc&_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	rtn.DB.SetMaxOpenConns(1)
	globalSessionDB = rtn

	// Run migrations
	err = migrateutil.Migrate("zeroai", globalSessionDB.DB, dbfs.ZeroaiMigrationFS, "migrations-zeroai")
	if err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

// GetSessionDB returns the global database instance
func GetSessionDB() *sqlx.DB {
	return globalSessionDB
}

// getDBName returns the database file path
func getDBName() string {
	waveHome := wavebase.GetWaveDataDir()
	return filepath.Join(waveHome, wavebase.WaveDBDir, ZeroaiDBName)
}

// sessionDB implements SessionStore interface
type sessionDB struct {
	db *sqlx.DB
}

// NewSessionStore creates a new session store
func NewSessionStore() (SessionStore, error) {
	if err := InitSessionStore(); err != nil {
		return nil, err
	}
	return &sessionDB{db: globalSessionDB}, nil
}

func (s *sessionDB) Create(session *Session) error {
	now := time.Now().Unix()
	if session.CreatedAt == 0 {
		session.CreatedAt = now
	}
	if session.UpdatedAt == 0 {
		session.UpdatedAt = now
	}

	query := `
		INSERT INTO zeroai_sessions (
			session_id, backend, work_dir, model, provider, thinking_level,
			yolo_mode, acp_session_id, metadata, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := s.db.Exec(
		query,
		session.ID, session.Backend, session.WorkDir, session.Model, session.Provider,
		session.ThinkingLevel, boolToInt(session.YoloMode), session.SessionID,
		session.Metadata, session.CreatedAt, session.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	return nil
}

func (s *sessionDB) Get(sessionID string) (*Session, error) {
	query := `
		SELECT session_id, backend, work_dir, model, provider, thinking_level,
		       yolo_mode, acp_session_id, metadata, created_at, updated_at
		FROM zeroai_sessions WHERE session_id = ?
	`
	row := s.db.QueryRow(query, sessionID)

	var session Session
	var metadataStr string
	var yoloMode int
	err := row.Scan(
		&session.ID, &session.Backend, &session.WorkDir, &session.Model,
		&session.Provider, &session.ThinkingLevel, &yoloMode,
		&session.SessionID, &metadataStr, &session.CreatedAt, &session.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	session.YoloMode = intToBool(yoloMode)
	if metadataStr != "" {
		session.Metadata = metadataStr
	}

	return &session, nil
}

func (s *sessionDB) Update(session *Session) error {
	session.UpdatedAt = time.Now().Unix()

	query := `
		UPDATE zeroai_sessions SET
			backend = ?, work_dir = ?, model = ?, provider = ?,
			thinking_level = ?, yolo_mode = ?, acp_session_id = ?,
			metadata = ?, updated_at = ?
		WHERE session_id = ?
	`
	result, err := s.db.Exec(
		query,
		session.Backend, session.WorkDir, session.Model, session.Provider,
		session.ThinkingLevel, boolToInt(session.YoloMode), session.SessionID,
		session.Metadata, session.UpdatedAt, session.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("session not found")
	}

	return nil
}

func (s *sessionDB) Delete(sessionID string) error {
	query := `DELETE FROM zeroai_sessions WHERE session_id = ?`
	result, err := s.db.Exec(query, sessionID)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("session not found")
	}

	return nil
}

func (s *sessionDB) List(opts ListOptions) ([]*Session, error) {
	query := `
		SELECT session_id, backend, work_dir, model, provider, thinking_level,
		       yolo_mode, acp_session_id, metadata, created_at, updated_at
		FROM zeroai_sessions
	`
	args := []interface{}{}

	if opts.Backend != "" {
		query += " WHERE backend = ?"
		args = append(args, opts.Backend)
	}

	query += " ORDER BY created_at DESC"

	if opts.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, opts.Limit)
		if opts.Offset > 0 {
			query += " OFFSET ?"
			args = append(args, opts.Offset)
		}
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []*Session
	for rows.Next() {
		var session Session
		var metadataStr string
		var yoloMode int
		err := rows.Scan(
			&session.ID, &session.Backend, &session.WorkDir, &session.Model,
			&session.Provider, &session.ThinkingLevel, &yoloMode,
			&session.SessionID, &metadataStr, &session.CreatedAt, &session.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session: %w", err)
		}

		session.YoloMode = intToBool(yoloMode)
		if metadataStr != "" {
			session.Metadata = metadataStr
		}
		sessions = append(sessions, &session)
	}

	return sessions, nil
}

// Helper functions
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func intToBool(i int) bool {
	return i != 0
}

// WithTx executes a function within a transaction
func WithTx(ctx context.Context, fn func(*sqlx.Tx) error) error {
	tx, err := globalSessionDB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}

	return tx.Commit()
}
