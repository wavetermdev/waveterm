// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package team

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// MemoryTeamStore is an in-memory implementation of TeamStore
// Useful for testing and development. For production, use a database-backed implementation.
type MemoryTeamStore struct {
	mu sync.RWMutex

	teams   map[string]*Team
	members map[string]map[string]*TeamMember // teamID -> agentID -> member
	tasks   map[string]*Task                  // taskID -> task
}

// NewMemoryTeamStore creates a new in-memory team store
func NewMemoryTeamStore() *MemoryTeamStore {
	return &MemoryTeamStore{
		teams:   make(map[string]*Team),
		members: make(map[string]map[string]*TeamMember),
		tasks:   make(map[string]*Task),
	}
}

// CreateTeam stores a new team
func (s *MemoryTeamStore) CreateTeam(team *Team) error {
	if team == nil {
		return errors.New("team is required")
	}
	if team.TeamID == "" {
		return errors.New("team ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[team.TeamID]; exists {
		return fmt.Errorf("team already exists: %s", team.TeamID)
	}

	if team.Status == "" {
		team.Status = TeamStatusActive
	}
	if team.Created == 0 {
		team.Created = time.Now().Unix()
	}

	// Initialize members map for the team
	s.members[team.TeamID] = make(map[string]*TeamMember)

	teamCopy := *team
	s.teams[team.TeamID] = &teamCopy

	return nil
}

// GetTeam retrieves a team by ID
func (s *MemoryTeamStore) GetTeam(teamID string) (*Team, error) {
	if teamID == "" {
		return nil, errors.New("team ID is required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if team, exists := s.teams[teamID]; exists {
		teamCopy := *team
		return &teamCopy, nil
	}

	return nil, fmt.Errorf("team not found: %s", teamID)
}

// ListTeams returns all teams with optional filtering
func (s *MemoryTeamStore) ListTeams(opts ListTeamsOptions) ([]*Team, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Team
	for _, team := range s.teams {
		// Apply status filter
		if opts.Status != "" && team.Status != opts.Status {
			continue
		}

		teamCopy := *team
		result = append(result, &teamCopy)
	}

	// Apply limit and offset
	if opts.Offset > 0 && opts.Offset < len(result) {
		result = result[opts.Offset:]
	}
	if opts.Limit > 0 && opts.Limit < len(result) {
		result = result[:opts.Limit]
	}

	return result, nil
}

// UpdateTeam updates an existing team
func (s *MemoryTeamStore) UpdateTeam(team *Team) error {
	if team == nil {
		return errors.New("team is required")
	}
	if team.TeamID == "" {
		return errors.New("team ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[team.TeamID]; !exists {
		return fmt.Errorf("team not found: %s", team.TeamID)
	}

	teamCopy := *team
	s.teams[team.TeamID] = &teamCopy

	return nil
}

// DeleteTeam removes a team by ID (including all members and tasks)
func (s *MemoryTeamStore) DeleteTeam(teamID string) error {
	if teamID == "" {
		return errors.New("team ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[teamID]; !exists {
		return fmt.Errorf("team not found: %s", teamID)
	}

	// Delete team
	delete(s.teams, teamID)

	// Delete members
	delete(s.members, teamID)

	// Delete tasks for this team
	for taskID, task := range s.tasks {
		if task.TeamID == teamID {
			delete(s.tasks, taskID)
		}
	}

	return nil
}

// AddMember adds a member to a team
func (s *MemoryTeamStore) AddMember(teamID string, member *TeamMember) error {
	if teamID == "" {
		return errors.New("team ID is required")
	}
	if member == nil {
		return errors.New("member is required")
	}
	if member.AgentID == "" {
		return errors.New("agent ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[teamID]; !exists {
		return fmt.Errorf("team not found: %s", teamID)
	}

	if _, exists := s.members[teamID]; !exists {
		s.members[teamID] = make(map[string]*TeamMember)
	}

	if _, exists := s.members[teamID][member.AgentID]; exists {
		return fmt.Errorf("member already exists: %s", member.AgentID)
	}

	if member.Status == "" {
		member.Status = MemberStatusActive
	}
	if member.JoinedAt == 0 {
		member.JoinedAt = time.Now().Unix()
	}

	memberCopy := *member
	s.members[teamID][member.AgentID] = &memberCopy

	return nil
}

// GetMembers retrieves all members of a team
func (s *MemoryTeamStore) GetMembers(teamID string) ([]*TeamMember, error) {
	if teamID == "" {
		return nil, errors.New("team ID is required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, exists := s.teams[teamID]; !exists {
		return nil, fmt.Errorf("team not found: %s", teamID)
	}

	members, exists := s.members[teamID]
	if !exists {
		return []*TeamMember{}, nil
	}

	result := make([]*TeamMember, 0, len(members))
	for _, member := range members {
		memberCopy := *member
		result = append(result, &memberCopy)
	}

	return result, nil
}

// UpdateMember updates a member's status or role
func (s *MemoryTeamStore) UpdateMember(teamID, agentID string, member *TeamMember) error {
	if teamID == "" {
		return errors.New("team ID is required")
	}
	if agentID == "" {
		return errors.New("agent ID is required")
	}
	if member == nil {
		return errors.New("member is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[teamID]; !exists {
		return fmt.Errorf("team not found: %s", teamID)
	}

	members, exists := s.members[teamID]
	if !exists {
		return fmt.Errorf("member not found: %s", agentID)
	}

	if _, exists := members[agentID]; !exists {
		return fmt.Errorf("member not found: %s", agentID)
	}

	// Update member fields
	memberCopy := *member
	s.members[teamID][agentID] = &memberCopy

	return nil
}

// RemoveMember removes a member from a team
func (s *MemoryTeamStore) RemoveMember(teamID, agentID string) error {
	if teamID == "" {
		return errors.New("team ID is required")
	}
	if agentID == "" {
		return errors.New("agent ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[teamID]; !exists {
		return fmt.Errorf("team not found: %s", teamID)
	}

	members, exists := s.members[teamID]
	if !exists {
		return fmt.Errorf("member not found: %s", agentID)
	}

	if _, exists := members[agentID]; !exists {
		return fmt.Errorf("member not found: %s", agentID)
	}

	delete(members, agentID)

	return nil
}

// CreateTask creates a new task for a team
func (s *MemoryTeamStore) CreateTask(task *Task) error {
	if task == nil {
		return errors.New("task is required")
	}
	if task.TaskID == "" {
		task.TaskID = uuid.New().String()
	}
	if task.TeamID == "" {
		return errors.New("team ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.teams[task.TeamID]; !exists {
		return fmt.Errorf("team not found: %s", task.TeamID)
	}

	if task.Status == "" {
		task.Status = TaskStatusPending
	}
	if task.CreatedAt == 0 {
		task.CreatedAt = time.Now().Unix()
	}

	taskCopy := *task
	s.tasks[task.TaskID] = &taskCopy

	return nil
}

// GetTask retrieves a task by ID
func (s *MemoryTeamStore) GetTask(taskID string) (*Task, error) {
	if taskID == "" {
		return nil, errors.New("task ID is required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if task, exists := s.tasks[taskID]; exists {
		taskCopy := *task
		return &taskCopy, nil
	}

	return nil, fmt.Errorf("task not found: %s", taskID)
}

// ListTasks returns tasks for a team with optional filtering
func (s *MemoryTeamStore) ListTasks(teamID string, opts ListTasksOptions) ([]*Task, error) {
	if teamID == "" {
		return nil, errors.New("team ID is required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, exists := s.teams[teamID]; !exists {
		return nil, fmt.Errorf("team not found: %s", teamID)
	}

	var result []*Task
	for _, task := range s.tasks {
		// Apply status filter
		if opts.Status != "" && task.Status != opts.Status {
			continue
		}
		// Apply assigned agent filter
		if opts.AssignedAgentID != "" && task.AssignedAgentID != opts.AssignedAgentID {
			continue
		}

		taskCopy := *task
		result = append(result, &taskCopy)
	}

	// Apply limit and offset
	if opts.Offset > 0 && opts.Offset < len(result) {
		result = result[opts.Offset:]
	}
	if opts.Limit > 0 && opts.Limit < len(result) {
		result = result[:opts.Limit]
	}

	return result, nil
}

// UpdateTask updates a task's status or other fields
func (s *MemoryTeamStore) UpdateTask(task *Task) error {
	if task == nil {
		return errors.New("task is required")
	}
	if task.TaskID == "" {
		return errors.New("task ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.tasks[task.TaskID]; !exists {
		return fmt.Errorf("task not found: %s", task.TaskID)
	}

	// Auto-update CompletedAt when status is completed
	if task.Status == TaskStatusCompleted && task.CompletedAt == 0 {
		task.CompletedAt = time.Now().Unix()
	}

	taskCopy := *task
	s.tasks[task.TaskID] = &taskCopy

	return nil
}

// DeleteTask removes a task
func (s *MemoryTeamStore) DeleteTask(taskID string) error {
	if taskID == "" {
		return errors.New("task ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.tasks[taskID]; !exists {
		return fmt.Errorf("task not found: %s", taskID)
	}

	delete(s.tasks, taskID)

	return nil
}
