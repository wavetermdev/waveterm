// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package store

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

// messageDB implements MessageStore interface
type messageDB struct {
	db *sqlx.DB
}

// NewMessageStore creates a new message store
func NewMessageStore() (MessageStore, error) {
	if err := InitSessionStore(); err != nil {
		return nil, err
	}
	return &messageDB{db: globalSessionDB}, nil
}

func (m *messageDB) Add(msg *Message) error {
	now := time.Now().Unix()
	if msg.CreatedAt == 0 {
		msg.CreatedAt = now
	}

	query := `
		INSERT INTO zeroai_messages (session_id, role, content, event_type, metadata, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`
	result, err := m.db.Exec(
		query,
		msg.SessionID, msg.Role, msg.Content, msg.EventType,
		msg.Metadata, msg.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to add message: %w", err)
	}

	id, _ := result.LastInsertId()
	msg.ID = id
	return nil
}

func (m *messageDB) GetSessionMessages(sessionID string) ([]*Message, error) {
	query := `
		SELECT id, session_id, role, content, event_type, metadata, created_at
		FROM zeroai_messages
		WHERE session_id = ?
		ORDER BY created_at ASC
	`
	rows, err := m.db.Query(query, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}
	defer rows.Close()

	var messages []*Message
	for rows.Next() {
		var msg Message
		var metadataStr string
		err := rows.Scan(
			&msg.ID, &msg.SessionID, &msg.Role, &msg.Content,
			&msg.EventType, &metadataStr, &msg.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}

		if metadataStr != "" {
			msg.Metadata = metadataStr
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}

func (m *messageDB) Delete(sessionID string) error {
	query := `DELETE FROM zeroai_messages WHERE session_id = ?`
	_, err := m.db.Exec(query, sessionID)
	if err != nil {
		return fmt.Errorf("failed to delete messages: %w", err)
	}
	return nil
}
