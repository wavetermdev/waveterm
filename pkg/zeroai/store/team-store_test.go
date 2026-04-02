// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wavetermdev/waveterm/pkg/zeroai/types"
)

func TestTeamStore_CreateAndGet(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{
		Name: "Test Team",
		Metadata: map[string]any{
			"owner": "test-user",
		},
	}

	err = store.CreateTeam(team)
	require.NoError(t, err)
	assert.NotEmpty(t, team.ID)

	retrieved, err := store.GetTeam(team.ID)
	require.NoError(t, err)
	assert.Equal(t, team.ID, retrieved.ID)
	assert.Equal(t, team.Name, retrieved.Name)
	assert.Equal(t, "test-user", retrieved.Metadata["owner"])

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_ListTeams(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	// Clean up any existing teams
	teams, _ := store.ListTeams()
	for _, existing := range teams {
		_ = store.DeleteTeam(existing.ID)
	}

	team1 := &types.Team{Name: "Team 1"}
	team2 := &types.Team{Name: "Team 2"}

	err = store.CreateTeam(team1)
	require.NoError(t, err)
	err = store.CreateTeam(team2)
	require.NoError(t, err)

	list, err := store.ListTeams()
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// Cleanup
	_ = store.DeleteTeam(team1.ID)
	_ = store.DeleteTeam(team2.ID)
}

func TestTeamStore_DeleteTeam(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Delete Test"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	err = store.DeleteTeam(team.ID)
	require.NoError(t, err)

	_, err = store.GetTeam(team.ID)
	assert.Error(t, err)
}

func TestTeamStore_AddTeamMember(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Member Test Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	member := &types.TeamMember{
		TeamID:    team.ID,
		AgentID:   "agent-1",
		AgentName: "Test Agent",
		Role:      "worker",
	}

	err = store.AddTeamMember(member)
	require.NoError(t, err)
	assert.NotEmpty(t, member.ID)

	members, err := store.GetTeamMembers(team.ID)
	require.NoError(t, err)
	assert.Len(t, members, 1)
	assert.Equal(t, "agent-1", members[0].AgentID)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_RemoveTeamMember(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Remove Member Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	member := &types.TeamMember{
		TeamID:    team.ID,
		AgentID:   "agent-1",
		AgentName: "Test Agent",
	}
	err = store.AddTeamMember(member)
	require.NoError(t, err)

	err = store.RemoveTeamMember(member.ID)
	require.NoError(t, err)

	members, err := store.GetTeamMembers(team.ID)
	require.NoError(t, err)
	assert.Len(t, members, 0)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_GetMemberByAgent(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Get By Agent Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	member := &types.TeamMember{
		TeamID:    team.ID,
		AgentID:   "find-me",
		AgentName: "Findable Agent",
		Role:      "coordinator",
	}
	err = store.AddTeamMember(member)
	require.NoError(t, err)

	found, err := store.GetMemberByAgent(team.ID, "find-me")
	require.NoError(t, err)
	assert.Equal(t, member.ID, found.ID)
	assert.Equal(t, "coordinator", found.Role)

	_, err = store.GetMemberByAgent(team.ID, "not-found")
	assert.Error(t, err)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_CreateTask(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Task Test Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	task := &types.TeamTask{
		TeamID:      team.ID,
		Subject:     "Test Task",
		Description: "A test task description",
		Status:      "pending",
		Priority:    "high",
	}

	err = store.CreateTask(task)
	require.NoError(t, err)
	assert.NotEmpty(t, task.ID)

	retrieved, err := store.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, task.ID, retrieved.ID)
	assert.Equal(t, "high", retrieved.Priority)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_ListTeamTasks(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "List Tasks Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	task1 := &types.TeamTask{TeamID: team.ID, Subject: "Task 1"}
	task2 := &types.TeamTask{TeamID: team.ID, Subject: "Task 2"}

	err = store.CreateTask(task1)
	require.NoError(t, err)
	err = store.CreateTask(task2)
	require.NoError(t, err)

	tasks, err := store.ListTeamTasks(team.ID)
	require.NoError(t, err)
	assert.Len(t, tasks, 2)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_AssignTaskToAgent(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Assign Task Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	task := &types.TeamTask{TeamID: team.ID, Subject: "Assignment Test"}
	err = store.CreateTask(task)
	require.NoError(t, err)

	err = store.AssignTaskToAgent(task.ID, "assigned-agent")
	require.NoError(t, err)

	retrieved, err := store.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, "assigned-agent", retrieved.OwnerAgent)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_UpdateTaskStatus(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Status Update Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	task := &types.TeamTask{TeamID: team.ID, Subject: "Status Test", Status: "pending"}
	err = store.CreateTask(task)
	require.NoError(t, err)

	err = store.UpdateTaskStatus(task.ID, "in_progress")
	require.NoError(t, err)

	retrieved, err := store.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, "in_progress", retrieved.Status)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_DeleteTask(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Delete Task Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	task := &types.TeamTask{TeamID: team.ID, Subject: "Delete Test"}
	err = store.CreateTask(task)
	require.NoError(t, err)

	err = store.DeleteTask(task.ID)
	require.NoError(t, err)

	_, err = store.GetTask(task.ID)
	assert.Error(t, err)

	// Cleanup
	_ = store.DeleteTeam(team.ID)
}

func TestTeamStore_CascadeDelete(t *testing.T) {
	store, err := NewTeamStore()
	require.NoError(t, err)

	team := &types.Team{Name: "Cascade Team"}
	err = store.CreateTeam(team)
	require.NoError(t, err)

	member := &types.TeamMember{TeamID: team.ID, AgentID: "agent-x", AgentName: "Agent X"}
	err = store.AddTeamMember(member)
	require.NoError(t, err)

	task := &types.TeamTask{TeamID: team.ID, Subject: "Task X"}
	err = store.CreateTask(task)
	require.NoError(t, err)

	// Delete team - should cascade to members and tasks
	err = store.DeleteTeam(team.ID)
	require.NoError(t, err)

	_, err = store.GetTeamMembers(team.ID)
	assert.Error(t, err)

	_, err = store.ListTeamTasks(team.ID)
	assert.Error(t, err)
}
