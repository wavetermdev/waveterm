// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// ZeroAI Team WSH Server RPC handlers
package rpc

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/zeroai/team"
)

// Team Management

// ZeroAiCreateTeamCommand creates a new team
func (zs *WshRpcZeroaiServer) ZeroAiCreateTeamCommand(ctx context.Context, req wshrpc.CommandZeroAiCreateTeamData) (wshrpc.CommandZeroAiCreateTeamRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiCreateTeamCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiCreateTeamRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	createdTeam, err := zs.teamCoordinator.CreateTeam(req.Name, req.LeaderID)
	if err != nil {
		return wshrpc.CommandZeroAiCreateTeamRtnData{}, err
	}

	return wshrpc.CommandZeroAiCreateTeamRtnData{
		TeamID: createdTeam.TeamID,
	}, nil
}

// ZeroAiGetTeamCommand retrieves a team by ID
func (zs *WshRpcZeroaiServer) ZeroAiGetTeamCommand(ctx context.Context, req wshrpc.CommandZeroAiGetTeamData) (wshrpc.CommandZeroAiGetTeamRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiGetTeamCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiGetTeamRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	teamData, err := zs.teamCoordinator.GetTeam(req.TeamID)
	if err != nil {
		return wshrpc.CommandZeroAiGetTeamRtnData{}, err
	}

	return wshrpc.CommandZeroAiGetTeamRtnData{
		Team: toTeamWrapper(teamData),
	}, nil
}

// ZeroAiListTeamsCommand lists all teams with optional filtering
func (zs *WshRpcZeroaiServer) ZeroAiListTeamsCommand(ctx context.Context, req wshrpc.CommandZeroAiListTeamsData) (wshrpc.CommandZeroAiListTeamsRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiListTeamsCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiListTeamsRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	opts := team.ListTeamsOptions{
		Status: team.TeamStatus(req.Status),
	}

	teams, err := zs.teamCoordinator.ListTeams(opts)
	if err != nil {
		return wshrpc.CommandZeroAiListTeamsRtnData{}, err
	}

	result := make([]*wshrpc.ZeroAiTeamInfo, len(teams))
	for i, t := range teams {
		result[i] = toTeamWrapper(t)
	}

	return wshrpc.CommandZeroAiListTeamsRtnData{
		Teams: result,
	}, nil
}

// ZeroAiDeleteTeamCommand deletes a team
func (zs *WshRpcZeroaiServer) ZeroAiDeleteTeamCommand(ctx context.Context, req wshrpc.CommandZeroAiDeleteTeamData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiDeleteTeamCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return fmt.Errorf("team coordinator not initialized")
	}

	return zs.teamCoordinator.DeleteTeam(req.TeamID)
}

// TeamMember Management

// ZeroAiJoinTeamCommand adds a member to a team
func (zs *WshRpcZeroaiServer) ZeroAiJoinTeamCommand(ctx context.Context, req wshrpc.CommandZeroAiJoinTeamData) (wshrpc.CommandZeroAiJoinTeamRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiJoinTeamCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiJoinTeamRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	role := team.MemberRole(req.Role)
	if role == "" {
		role = team.MemberRoleWorker
	}

	_, err := zs.teamCoordinator.AddMember(req.TeamID, req.AgentID, role)
	if err != nil {
		return wshrpc.CommandZeroAiJoinTeamRtnData{}, err
	}

	return wshrpc.CommandZeroAiJoinTeamRtnData{
		Success: true,
	}, nil
}

// ZeroAiLeaveTeamCommand removes a member from a team
func (zs *WshRpcZeroaiServer) ZeroAiLeaveTeamCommand(ctx context.Context, req wshrpc.CommandZeroAiLeaveTeamData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiLeaveTeamCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return fmt.Errorf("team coordinator not initialized")
	}

	return zs.teamCoordinator.RemoveMember(req.TeamID, req.AgentID)
}

// ZeroAiListTeamMembersCommand lists all members of a team
func (zs *WshRpcZeroaiServer) ZeroAiListTeamMembersCommand(ctx context.Context, req wshrpc.CommandZeroAiListTeamMembersData) (wshrpc.CommandZeroAiListTeamMembersRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiListTeamMembersCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiListTeamMembersRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	members, err := zs.teamCoordinator.GetMembers(req.TeamID)
	if err != nil {
		return wshrpc.CommandZeroAiListTeamMembersRtnData{}, err
	}

	result := make([]*wshrpc.ZeroAiTeamMemberInfo, len(members))
	for i, m := range members {
		result[i] = toTeamMemberWrapper(m)
	}

	return wshrpc.CommandZeroAiListTeamMembersRtnData{
		Members: result,
	}, nil
}

// Task Management

// ZeroAiCreateTaskCommand creates a new task
func (zs *WshRpcZeroaiServer) ZeroAiCreateTaskCommand(ctx context.Context, req wshrpc.CommandZeroAiCreateTaskData) (wshrpc.CommandZeroAiCreateTaskRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiCreateTaskCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiCreateTaskRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	task, err := zs.teamCoordinator.CreateTask(req.TeamID, req.Description, req.AssignedAgentID)
	if err != nil {
		return wshrpc.CommandZeroAiCreateTaskRtnData{}, err
	}

	return wshrpc.CommandZeroAiCreateTaskRtnData{
		TaskID: task.TaskID,
	}, nil
}

// ZeroAiAssignTaskCommand assigns a task to an agent
func (zs *WshRpcZeroaiServer) ZeroAiAssignTaskCommand(ctx context.Context, req wshrpc.CommandZeroAiAssignTaskData) (wshrpc.CommandZeroAiAssignTaskRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiAssignTaskCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiAssignTaskRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	err := zs.teamCoordinator.AssignTask(req.TaskID, req.AgentID)
	if err != nil {
		return wshrpc.CommandZeroAiAssignTaskRtnData{}, err
	}

	return wshrpc.CommandZeroAiAssignTaskRtnData{
		Success: true,
	}, nil
}

// ZeroAiListTasksCommand lists tasks for a team with optional filtering
func (zs *WshRpcZeroaiServer) ZeroAiListTasksCommand(ctx context.Context, req wshrpc.CommandZeroAiListTasksData) (wshrpc.CommandZeroAiListTasksRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiListTasksCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiListTasksRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	opts := team.ListTasksOptions{
		AssignedAgentID: req.AssignedAgentID,
		Status:          team.TaskStatus(req.Status),
	}

	tasks, err := zs.teamCoordinator.ListTasks(req.TeamID, opts)
	if err != nil {
		return wshrpc.CommandZeroAiListTasksRtnData{}, err
	}

	result := make([]*wshrpc.ZeroAiTaskInfo, len(tasks))
	for i, t := range tasks {
		result[i] = toTaskWrapper(t)
	}

	return wshrpc.CommandZeroAiListTasksRtnData{
		Tasks: result,
	}, nil
}

// ZeroAiGetTaskStatusCommand retrieves the status of a task
func (zs *WshRpcZeroaiServer) ZeroAiGetTaskStatusCommand(ctx context.Context, req wshrpc.CommandZeroAiGetTaskStatusData) (wshrpc.CommandZeroAiGetTaskStatusRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiGetTaskStatusCommand", recover())
	}()

	if zs.teamCoordinator == nil {
		return wshrpc.CommandZeroAiGetTaskStatusRtnData{}, fmt.Errorf("team coordinator not initialized")
	}

	task, err := zs.teamCoordinator.GetTask(req.TaskID)
	if err != nil {
		return wshrpc.CommandZeroAiGetTaskStatusRtnData{}, err
	}

	return wshrpc.CommandZeroAiGetTaskStatusRtnData{
		Task: toTaskWrapper(task),
	}, nil
}

// Message Routing

// ZeroAiSendToAgentCommand sends a message to a specific agent
func (zs *WshRpcZeroaiServer) ZeroAiSendToAgentCommand(ctx context.Context, req wshrpc.CommandZeroAiSendToAgentData) (wshrpc.CommandZeroAiSendToAgentRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiSendToAgentCommand", recover())
	}()

	if zs.messageRouter == nil {
		return wshrpc.CommandZeroAiSendToAgentRtnData{}, fmt.Errorf("message router not initialized")
	}

	// Create payload
	payload := map[string]interface{}{
		"content": req.Content,
	}
	if req.Payload != nil {
		for k, v := range req.Payload {
			payload[k] = v
		}
	}

	success := zs.messageRouter.SendToAgent(req.From, req.To, team.MessageType(req.Type), payload)

	return wshrpc.CommandZeroAiSendToAgentRtnData{
		Success: success,
	}, nil
}

// ZeroAiBroadcastCommand broadcasts a message to all agents
func (zs *WshRpcZeroaiServer) ZeroAiBroadcastCommand(ctx context.Context, req wshrpc.CommandZeroAiBroadcastData) (wshrpc.CommandZeroAiBroadcastRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiBroadcastCommand", recover())
	}()

	if zs.messageRouter == nil {
		return wshrpc.CommandZeroAiBroadcastRtnData{}, fmt.Errorf("message router not initialized")
	}

	// Create payload
	payload := map[string]interface{}{
		"content": req.Content,
	}
	if req.Payload != nil {
		for k, v := range req.Payload {
			payload[k] = v
		}
	}

	results := zs.messageRouter.Broadcast(req.From, team.MessageType(req.Type), payload)

	recipientCount := 0
	for _, success := range results {
		if success {
			recipientCount++
		}
	}

	return wshrpc.CommandZeroAiBroadcastRtnData{
		RecipientCount: recipientCount,
	}, nil
}

// Converter functions

// toTeamWrapper converts a team to its RPC wrapper
func toTeamWrapper(t *team.Team) *wshrpc.ZeroAiTeamInfo {
	return &wshrpc.ZeroAiTeamInfo{
		TeamID:  t.TeamID,
		Name:    t.Name,
		Created: t.Created,
		Status:  string(t.Status),
	}
}

// toTeamMemberWrapper converts a team member to its RPC wrapper
func toTeamMemberWrapper(m *team.TeamMember) *wshrpc.ZeroAiTeamMemberInfo {
	return &wshrpc.ZeroAiTeamMemberInfo{
		AgentID:  m.AgentID,
		Role:     string(m.Role),
		Status:   string(m.Status),
		JoinedAt: m.JoinedAt,
	}
}

// toTaskWrapper converts a task to its RPC wrapper
func toTaskWrapper(t *team.Task) *wshrpc.ZeroAiTaskInfo {
	return &wshrpc.ZeroAiTaskInfo{
		TaskID:          t.TaskID,
		TeamID:          t.TeamID,
		AssignedAgentID: t.AssignedAgentID,
		Status:          string(t.Status),
		Description:     t.Description,
		CreatedAt:       t.CreatedAt,
		CompletedAt:     t.CompletedAt,
	}
}
