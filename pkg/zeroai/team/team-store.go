// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package team

// TeamStore provides storage operations for teams and members
type TeamStore interface {
	// CreateTeam stores a new team
	CreateTeam(team *Team) error

	// GetTeam retrieves a team by ID
	GetTeam(teamID string) (*Team, error)

	// ListTeams returns all teams with optional filtering
	ListTeams(opts ListTeamsOptions) ([]*Team, error)

	// UpdateTeam updates an existing team
	UpdateTeam(team *Team) error

	// DeleteTeam removes a team by ID (including all members and tasks)
	DeleteTeam(teamID string) error

	// AddMember adds a member to a team
	AddMember(teamID string, member *TeamMember) error

	// GetMembers retrieves all members of a team
	GetMembers(teamID string) ([]*TeamMember, error)

	// UpdateMember updates a member's status or role
	UpdateMember(teamID, agentID string, member *TeamMember) error

	// RemoveMember removes a member from a team
	RemoveMember(teamID, agentID string) error

	// CreateTask creates a new task for a team
	CreateTask(task *Task) error

	// GetTask retrieves a task by ID
	GetTask(taskID string) (*Task, error)

	// ListTasks returns tasks for a team with optional filtering
	ListTasks(teamID string, opts ListTasksOptions) ([]*Task, error)

	// UpdateTask updates a task's status or other fields
	UpdateTask(task *Task) error

	// DeleteTask removes a task
	DeleteTask(taskID string) error
}

// ListTeamsOptions provides filtering options for listing teams
type ListTeamsOptions struct {
	Status TeamStatus
	Limit  int
	Offset int
}

// ListTasksOptions provides filtering options for listing tasks
type ListTasksOptions struct {
	Status          TaskStatus
	AssignedAgentID string
	Limit           int
	Offset          int
}
