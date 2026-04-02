// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package store

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/wavetermdev/waveterm/pkg/zeroai/types"
)

// TeamStore provides storage operations for teams, members, and tasks
type TeamStore interface {
	// Team operations
	CreateTeam(team *types.Team) error
	GetTeam(teamID string) (*types.Team, error)
	ListTeams() ([]*types.Team, error)
	DeleteTeam(teamID string) error

	// Team member operations
	AddTeamMember(member *types.TeamMember) error
	RemoveTeamMember(memberID string) error
	GetTeamMembers(teamID string) ([]*types.TeamMember, error)
	GetMemberByAgent(teamID, agentID string) (*types.TeamMember, error)

	// Team task operations
	CreateTask(task *types.TeamTask) error
	GetTask(taskID string) (*types.TeamTask, error)
	ListTeamTasks(teamID string) ([]*types.TeamTask, error)
	AssignTaskToAgent(taskID, agentID string) error
	UpdateTaskStatus(taskID, status string) error
	DeleteTask(taskID string) error
}

// teamDB implements TeamStore interface
type teamDB struct {
	db *sqlx.DB
}

// NewTeamStore creates a new team store
func NewTeamStore() (TeamStore, error) {
	if err := InitSessionStore(); err != nil {
		return nil, err
	}
	return &teamDB{db: globalSessionDB}, nil
}

// Helper: encode metadata to JSON string
func encodeMetadata(metadata map[string]any) (string, error) {
	if metadata == nil || len(metadata) == 0 {
		return "", nil
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		return "", fmt.Errorf("failed to encode metadata: %w", err)
	}
	return string(data), nil
}

// Helper: decode metadata from JSON string
func decodeMetadata(data string) (map[string]any, error) {
	if data == "" {
		return nil, nil
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal([]byte(data), &metadata); err != nil {
		return nil, fmt.Errorf("failed to decode metadata: %w", err)
	}
	return metadata, nil
}

// ==================== Team Operations ====================

func (t *teamDB) CreateTeam(team *types.Team) error {
	now := time.Now().Unix()
	if team.CreatedAt == 0 {
		team.CreatedAt = now
	}
	if team.UpdatedAt == 0 {
		team.UpdatedAt = now
	}
	if team.ID == "" {
		team.ID = uuid.New().String()
	}

	metadataStr, err := encodeMetadata(team.Metadata)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO zeroai_teams (team_id, name, metadata, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`
	_, err = t.db.Exec(query, team.ID, team.Name, metadataStr, team.CreatedAt, team.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create team: %w", err)
	}
	return nil
}

func (t *teamDB) GetTeam(teamID string) (*types.Team, error) {
	query := `
		SELECT team_id, name, metadata, created_at, updated_at
		FROM zeroai_teams WHERE team_id = ?
	`
	row := t.db.QueryRow(query, teamID)

	var team types.Team
	var metadataStr string
	err := row.Scan(&team.ID, &team.Name, &metadataStr, &team.CreatedAt, &team.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to get team: %w", err)
	}

	if metadataStr != "" {
		team.Metadata, err = decodeMetadata(metadataStr)
		if err != nil {
			return nil, err
		}
	}

	return &team, nil
}

func (t *teamDB) ListTeams() ([]*types.Team, error) {
	query := `
		SELECT team_id, name, metadata, created_at, updated_at
		FROM zeroai_teams ORDER BY created_at DESC
	`
	rows, err := t.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to list teams: %w", err)
	}
	defer rows.Close()

	var teams []*types.Team
	for rows.Next() {
		var team types.Team
		var metadataStr string
		err := rows.Scan(&team.ID, &team.Name, &metadataStr, &team.CreatedAt, &team.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan team: %w", err)
		}

		if metadataStr != "" {
			team.Metadata, err = decodeMetadata(metadataStr)
			if err != nil {
				return nil, err
			}
		}
		teams = append(teams, &team)
	}

	return teams, nil
}

func (t *teamDB) DeleteTeam(teamID string) error {
	// Cascade delete will handle members and tasks
	query := `DELETE FROM zeroai_teams WHERE team_id = ?`
	result, err := t.db.Exec(query, teamID)
	if err != nil {
		return fmt.Errorf("failed to delete team: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("team not found")
	}

	return nil
}

// ==================== Team Member Operations ====================

func (t *teamDB) AddTeamMember(member *types.TeamMember) error {
	now := time.Now().Unix()
	if member.CreatedAt == 0 {
		member.CreatedAt = now
	}
	if member.ID == "" {
		member.ID = uuid.New().String()
	}

	// Default role to worker if not set
	if member.Role == "" {
		member.Role = "worker"
	}

	metadataStr, err := encodeMetadata(member.Metadata)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO zeroai_team_members (member_id, team_id, agent_id, agent_name, role, metadata, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`
	_, err = t.db.Exec(query, member.ID, member.TeamID, member.AgentID, member.AgentName, member.Role, metadataStr, member.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to add team member: %w", err)
	}
	return nil
}

func (t *teamDB) RemoveTeamMember(memberID string) error {
	query := `DELETE FROM zeroai_team_members WHERE member_id = ?`
	result, err := t.db.Exec(query, memberID)
	if err != nil {
		return fmt.Errorf("failed to remove team member: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("team member not found")
	}

	return nil
}

func (t *teamDB) GetTeamMembers(teamID string) ([]*types.TeamMember, error) {
	query := `
		SELECT member_id, team_id, agent_id, agent_name, role, metadata, created_at
		FROM zeroai_team_members WHERE team_id = ? ORDER BY created_at ASC
	`
	rows, err := t.db.Query(query, teamID)
	if err != nil {
		return nil, fmt.Errorf("failed to get team members: %w", err)
	}
	defer rows.Close()

	var members []*types.TeamMember
	for rows.Next() {
		var member types.TeamMember
		var metadataStr string
		err := rows.Scan(&member.ID, &member.TeamID, &member.AgentID, &member.AgentName, &member.Role, &metadataStr, &member.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan team member: %w", err)
		}

		if metadataStr != "" {
			member.Metadata, err = decodeMetadata(metadataStr)
			if err != nil {
				return nil, err
			}
		}
		members = append(members, &member)
	}

	return members, nil
}

func (t *teamDB) GetMemberByAgent(teamID, agentID string) (*types.TeamMember, error) {
	query := `
		SELECT member_id, team_id, agent_id, agent_name, role, metadata, created_at
		FROM zeroai_team_members WHERE team_id = ? AND agent_id = ?
	`
	row := t.db.QueryRow(query, teamID, agentID)

	var member types.TeamMember
	var metadataStr string
	err := row.Scan(&member.ID, &member.TeamID, &member.AgentID, &member.AgentName, &member.Role, &metadataStr, &member.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to get member: %w", err)
	}

	if metadataStr != "" {
		member.Metadata, err = decodeMetadata(metadataStr)
		if err != nil {
			return nil, err
		}
	}

	return &member, nil
}

// ==================== Team Task Operations ====================

func (t *teamDB) CreateTask(task *types.TeamTask) error {
	now := time.Now().Unix()
	if task.CreatedAt == 0 {
		task.CreatedAt = now
	}
	if task.UpdatedAt == 0 {
		task.UpdatedAt = now
	}
	if task.ID == "" {
		task.ID = uuid.New().String()
	}

	// Default values
	if task.Status == "" {
		task.Status = "pending"
	}
	if task.Priority == "" {
		task.Priority = "medium"
	}

	metadataStr, err := encodeMetadata(task.Metadata)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO zeroai_team_tasks (task_id, team_id, subject, description, status, owner_agent, priority, metadata, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err = t.db.Exec(query, task.ID, task.TeamID, task.Subject, task.Description, task.Status, task.OwnerAgent, task.Priority, metadataStr, task.CreatedAt, task.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create task: %w", err)
	}
	return nil
}

func (t *teamDB) GetTask(taskID string) (*types.TeamTask, error) {
	query := `
		SELECT task_id, team_id, subject, description, status, owner_agent, priority, metadata, created_at, updated_at
		FROM zeroai_team_tasks WHERE task_id = ?
	`
	row := t.db.QueryRow(query, taskID)

	var task types.TeamTask
	var metadataStr string
	err := row.Scan(&task.ID, &task.TeamID, &task.Subject, &task.Description, &task.Status, &task.OwnerAgent, &task.Priority, &metadataStr, &task.CreatedAt, &task.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	if metadataStr != "" {
		task.Metadata, err = decodeMetadata(metadataStr)
		if err != nil {
			return nil, err
		}
	}

	return &task, nil
}

func (t *teamDB) ListTeamTasks(teamID string) ([]*types.TeamTask, error) {
	query := `
		SELECT task_id, team_id, subject, description, status, owner_agent, priority, metadata, created_at, updated_at
		FROM zeroai_team_tasks WHERE team_id = ? ORDER BY created_at DESC
	`
	rows, err := t.db.Query(query, teamID)
	if err != nil {
		return nil, fmt.Errorf("failed to list team tasks: %w", err)
	}
	defer rows.Close()

	var tasks []*types.TeamTask
	for rows.Next() {
		var task types.TeamTask
		var metadataStr string
		err := rows.Scan(&task.ID, &task.TeamID, &task.Subject, &task.Description, &task.Status, &task.OwnerAgent, &task.Priority, &metadataStr, &task.CreatedAt, &task.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan task: %w", err)
		}

		if metadataStr != "" {
			task.Metadata, err = decodeMetadata(metadataStr)
			if err != nil {
				return nil, err
			}
		}
		tasks = append(tasks, &task)
	}

	return tasks, nil
}

func (t *teamDB) AssignTaskToAgent(taskID, agentID string) error {
	query := `UPDATE zeroai_team_tasks SET owner_agent = ?, updated_at = ? WHERE task_id = ?`
	result, err := t.db.Exec(query, agentID, time.Now().Unix(), taskID)
	if err != nil {
		return fmt.Errorf("failed to assign task: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("task not found")
	}

	return nil
}

func (t *teamDB) UpdateTaskStatus(taskID, status string) error {
	query := `UPDATE zeroai_team_tasks SET status = ?, updated_at = ? WHERE task_id = ?`
	result, err := t.db.Exec(query, status, time.Now().Unix(), taskID)
	if err != nil {
		return fmt.Errorf("failed to update task status: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("task not found")
	}

	return nil
}

func (t *teamDB) DeleteTask(taskID string) error {
	query := `DELETE FROM zeroai_team_tasks WHERE task_id = ?`
	result, err := t.db.Exec(query, taskID)
	if err != nil {
		return fmt.Errorf("failed to delete task: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("task not found")
	}

	return nil
}
