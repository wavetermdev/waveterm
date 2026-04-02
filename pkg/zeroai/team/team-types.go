// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package team

// TeamStatus represents the status of a team
type TeamStatus string

const (
	// TeamStatusActive indicates the team is active and accepting tasks
	TeamStatusActive TeamStatus = "active"
	// TeamStatusIdle indicates the team is idle but available
	TeamStatusIdle TeamStatus = "idle"
	// TeamStatusShutdown indicates the team is shutting down
	TeamStatusShutdown TeamStatus = "shutdown"
)

// Team represents a collaborative agent team
type Team struct {
	TeamID  string     `json:"teamId" db:"team_id"`
	Name    string     `json:"name" db:"name"`
	Created int64      `json:"created" db:"created"` // Unix timestamp
	Updated int64      `json:"updated" db:"updated"` // Unix timestamp
	Status  TeamStatus `json:"status" db:"status"`
}

// MemberRole represents the role of a team member
type MemberRole string

const (
	// MemberRoleLeader indicates the team leader
	MemberRoleLeader MemberRole = "leader"
	// MemberRoleWorker indicates a worker agent
	MemberRoleWorker MemberRole = "worker"
	// MemberRoleCoordinator indicates a coordination-only agent
	MemberRoleCoordinator MemberRole = "coordinator"
)

// MemberStatus represents the status of a team member
type MemberStatus string

const (
	// MemberStatusActive indicates the member is active
	MemberStatusActive MemberStatus = "active"
	// MemberStatusIdle indicates the member is idle
	MemberStatusIdle MemberStatus = "idle"
	// MemberStatusBusy indicates the member is working on a task
	MemberStatusBusy MemberStatus = "busy"
	// MemberStatusOffline indicates the member is offline
	MemberStatusOffline MemberStatus = "offline"
)

// TeamMember represents an agent that is part of a team
type TeamMember struct {
	MemberID string       `json:"memberId" db:"member_id"`
	AgentID  string       `json:"agentId" db:"agent_id"`
	Role     MemberRole   `json:"role" db:"role"`
	Status   MemberStatus `json:"status" db:"status"`
	JoinedAt int64        `json:"joinedAt" db:"joined_at"` // Unix timestamp
	LastActive int64       `json:"lastActive" db:"last_active"` // Unix timestamp, 0 if unknown
}

// TaskStatus represents the status of a task
type TaskStatus string

const (
	// TaskStatusPending indicates the task is pending
	TaskStatusPending TaskStatus = "pending"
	// TaskStatusInProgress indicates the task is in progress
	TaskStatusInProgress TaskStatus = "in_progress"
	// TaskStatusCompleted indicates the task is completed
	TaskStatusCompleted TaskStatus = "completed"
	// TaskStatusFailed indicates the task failed
	TaskStatusFailed TaskStatus = "failed"
	// TaskStatusBlocked indicates the task is blocked
	TaskStatusBlocked TaskStatus = "blocked"
)

// Task represents a work unit assigned to an agent within a team
type Task struct {
	TaskID          string     `json:"taskId" db:"task_id"`
	TeamID          string     `json:"teamId" db:"team_id"`
	AssignedAgentID string     `json:"assignedAgentId" db:"assigned_agent_id"`
	Status          TaskStatus `json:"status" db:"status"`
	Description     string     `json:"description" db:"description"`
	CreatedAt       int64      `json:"createdAt" db:"created_at"`     // Unix timestamp
	CompletedAt     int64      `json:"completedAt" db:"completed_at"` // Unix timestamp, 0 if not completed
}
