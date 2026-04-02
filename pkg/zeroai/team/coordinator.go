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

var (
	ErrTeamNotFound      = errors.New("team not found")
	ErrMemberNotFound    = errors.New("member not found")
	ErrTaskNotFound      = errors.New("task not found")
	ErrTeamAlreadyExists = errors.New("team already exists")
)

// Coordinator manages team lifecycle, task assignment, and member coordination
type Coordinator struct {
	store TeamStore
	mu    sync.RWMutex

	// Task worker loop state
	workerLoops map[string]*workerLoopState // teamID -> worker loop state
}

// workerLoopState tracks the state of a team's task worker loop
type workerLoopState struct {
	running bool
	stopCh  chan struct{}
}

// NewCoordinator creates a new team coordinator
func NewCoordinator(store TeamStore) (*Coordinator, error) {
	if store == nil {
		return nil, errors.New("team store is required")
	}

	c := &Coordinator{
		store:       store,
		workerLoops: make(map[string]*workerLoopState),
	}

	return c, nil
}

// CreateTeam creates a new team with the given leader
func (c *Coordinator) CreateTeam(name string, leaderID string) (*Team, error) {
	if name == "" {
		return nil, errors.New("team name is required")
	}
	if leaderID == "" {
		return nil, errors.New("leader ID is required")
	}

	teamID := uuid.New().String()

	team := &Team{
		TeamID:  teamID,
		Name:    name,
		Created: time.Now().Unix(),
		Status:  TeamStatusActive,
	}

	if err := c.store.CreateTeam(team); err != nil {
		return nil, fmt.Errorf("failed to create team: %w", err)
	}

	// Add leader as first member
	leader := &TeamMember{
		AgentID:  leaderID,
		Role:     MemberRoleLeader,
		Status:   MemberStatusActive,
		JoinedAt: time.Now().Unix(),
	}

	if err := c.store.AddMember(teamID, leader); err != nil {
		// Rollback team creation on member add failure
		_ = c.store.DeleteTeam(teamID)
		return nil, fmt.Errorf("failed to add leader to team: %w", err)
	}

	return team, nil
}

// GetTeam retrieves a team by ID
func (c *Coordinator) GetTeam(teamID string) (*Team, error) {
	return c.store.GetTeam(teamID)
}

// ListTeams lists all teams with optional filtering
func (c *Coordinator) ListTeams(opts ListTeamsOptions) ([]*Team, error) {
	return c.store.ListTeams(opts)
}

// AddMember adds a new member to a team
func (c *Coordinator) AddMember(teamID, agentID string, role MemberRole) (*TeamMember, error) {
	if teamID == "" {
		return nil, errors.New("team ID is required")
	}
	if agentID == "" {
		return nil, errors.New("agent ID is required")
	}

	if role == "" {
		role = MemberRoleWorker
	}

	// Verify team exists
	if _, err := c.store.GetTeam(teamID); err != nil {
		return nil, fmt.Errorf("team not found: %w", err)
	}

	member := &TeamMember{
		AgentID:  agentID,
		Role:     role,
		Status:   MemberStatusIdle,
		JoinedAt: time.Now().Unix(),
	}

	if err := c.store.AddMember(teamID, member); err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}

	return member, nil
}

// GetMembers retrieves all members of a team
func (c *Coordinator) GetMembers(teamID string) ([]*TeamMember, error) {
	return c.store.GetMembers(teamID)
}

// UpdateMemberStatus updates a member's status
func (c *Coordinator) UpdateMemberStatus(teamID, agentID string, status MemberStatus) error {
	// Get current member
	members, err := c.store.GetMembers(teamID)
	if err != nil {
		return err
	}

	var existingMember *TeamMember
	for _, m := range members {
		if m.AgentID == agentID {
			existingMember = m
			break
		}
	}

	if existingMember == nil {
		return ErrMemberNotFound
	}

	// Update status
	existingMember.Status = status
	return c.store.UpdateMember(teamID, agentID, existingMember)
}

// CreateTask creates a new task and optionally assigns it to a specific agent
func (c *Coordinator) CreateTask(teamID, description string, assignedAgentID string) (*Task, error) {
	if teamID == "" {
		return nil, errors.New("team ID is required")
	}
	if description == "" {
		return nil, errors.New("task description is required")
	}

	task := &Task{
		TaskID:          uuid.New().String(),
		TeamID:          teamID,
		AssignedAgentID: assignedAgentID,
		Status:          TaskStatusPending,
		Description:     description,
		CreatedAt:       time.Now().Unix(),
	}

	if err := c.store.CreateTask(task); err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	return task, nil
}

// GetTask retrieves a task by ID
func (c *Coordinator) GetTask(taskID string) (*Task, error) {
	return c.store.GetTask(taskID)
}

// ListTasks lists tasks for a team with optional filtering
func (c *Coordinator) ListTasks(teamID string, opts ListTasksOptions) ([]*Task, error) {
	return c.store.ListTasks(teamID, opts)
}

// GetNextPendingTask retrieves the next pending task for a team
func (c *Coordinator) GetNextPendingTask(teamID string) (*Task, error) {
	opts := ListTasksOptions{
		Status: TaskStatusPending,
		Limit:  1,
	}

	tasks, err := c.store.ListTasks(teamID, opts)
	if err != nil {
		return nil, err
	}

	if len(tasks) == 0 {
		return nil, nil // No pending tasks
	}

	return tasks[0], nil
}

// AssignTask assigns a task to a specific agent
func (c *Coordinator) AssignTask(taskID, agentID string) error {
	task, err := c.store.GetTask(taskID)
	if err != nil {
		return err
	}

	if task.Status != TaskStatusPending && task.Status != TaskStatusBlocked {
		return errors.New("task is not in a assignable state")
	}

	task.AssignedAgentID = agentID
	task.Status = TaskStatusInProgress

	return c.store.UpdateTask(task)
}

// StartTask marks a task as in progress
func (c *Coordinator) StartTask(taskID string) error {
	task, err := c.store.GetTask(taskID)
	if err != nil {
		return err
	}

	if task.Status != TaskStatusPending {
		return errors.New("task is not in pending state")
	}

	task.Status = TaskStatusInProgress
	return c.store.UpdateTask(task)
}

// CompleteTask marks a task as completed
func (c *Coordinator) CompleteTask(taskID string) error {
	task, err := c.store.GetTask(taskID)
	if err != nil {
		return err
	}

	if task.Status != TaskStatusInProgress && task.Status != TaskStatusBlocked {
		return errors.New("task is not in progress or blocked state")
	}

	task.Status = TaskStatusCompleted
	task.CompletedAt = time.Now().Unix()

	return c.store.UpdateTask(task)
}

// FailTask marks a task as failed
func (c *Coordinator) FailTask(taskID string) error {
	task, err := c.store.GetTask(taskID)
	if err != nil {
		return err
	}

	task.Status = TaskStatusFailed
	task.CompletedAt = time.Now().Unix()

	return c.store.UpdateTask(task)
}

// BlockTask marks a task as blocked with a dependency
func (c *Coordinator) BlockTask(taskID string, blockedBy Task) error {
	task, err := c.store.GetTask(taskID)
	if err != nil {
		return err
	}

	task.Status = TaskStatusBlocked
	return c.store.UpdateTask(task)
}

// GetAgentTasks retrieves all tasks assigned to a specific agent
func (c *Coordinator) GetAgentTasks(teamID, agentID string) ([]*Task, error) {
	opts := ListTasksOptions{
		AssignedAgentID: agentID,
	}

	return c.store.ListTasks(teamID, opts)
}

// GetActiveTask retrieves the currently active (in_progress) task for an agent
func (c *Coordinator) GetActiveTask(teamID, agentID string) (*Task, error) {
	opts := ListTasksOptions{
		Status:          TaskStatusInProgress,
		AssignedAgentID: agentID,
		Limit:           1,
	}

	tasks, err := c.store.ListTasks(teamID, opts)
	if err != nil {
		return nil, err
	}

	if len(tasks) == 0 {
		return nil, nil // No active task
	}

	return tasks[0], nil
}

// DeleteTeam deletes a team and all its members and tasks
func (c *Coordinator) DeleteTeam(teamID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Stop worker loop if running
	if state, exists := c.workerLoops[teamID]; exists && state.running {
		close(state.stopCh)
		state.running = false
		delete(c.workerLoops, teamID)
	}

	return c.store.DeleteTeam(teamID)
}

// RemoveMember removes a member from a team
func (c *Coordinator) RemoveMember(teamID, agentID string) error {
	// Check if member has active tasks
	tasks, err := c.GetAgentTasks(teamID, agentID)
	if err != nil {
		return err
	}

	for _, task := range tasks {
		if task.Status == TaskStatusInProgress {
			return fmt.Errorf("member has active task: %s", task.TaskID)
		}
	}

	return c.store.RemoveMember(teamID, agentID)
}
