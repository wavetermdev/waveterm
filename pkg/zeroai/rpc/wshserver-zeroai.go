// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// ZeroAI WSH Server RPC handlers
package rpc

import (
	"context"
	"encoding/json"
	"log"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/service"
	"github.com/wavetermdev/waveterm/pkg/zeroai/store"
	"github.com/wavetermdev/waveterm/pkg/zeroai/team"
)

// WshRpcZeroaiServer implements WSH RPC methods for ZeroAI
type WshRpcZeroaiServer struct {
	sessionService  SessionServiceInterface
	messageService  MessageServiceInterface
	agentService    *service.AgentService
	providerService *service.ProviderService
	teamCoordinator *team.Coordinator
	messageRouter   *team.MessageRouter
	defaultBackend  string
}

// SessionServiceInterface abstracts session service operations
type SessionServiceInterface interface {
	CreateSession(ctx context.Context, opts agent.AgentSessionOptions) (*agent.AgentSession, error)
	GetSession(sessionID string) (*agent.AgentSession, error)
	ListSessions() ([]*agent.AgentSession, error)
	DeleteSession(sessionID string) error
	SetWorkDir(sessionID string, workDir string) error
}

// MessageServiceInterface abstracts message service operations
type MessageServiceInterface interface {
	AddMessage(msg *store.Message) interface{}
	GetSessionMessages(sessionID string) ([]*store.Message, error)
	DeleteSessionMessages(sessionID string) error
}

// WshServerImpl implements the WshServerImpl interface marker
func (*WshRpcZeroaiServer) WshServerImpl() {}

// NewWshRpcZeroaiServer creates a new WshRpcZeroaiServer
func NewWshRpcZeroaiServer(
	sessionService SessionServiceInterface,
	messageService MessageServiceInterface,
	agentService *service.AgentService,
	providerService *service.ProviderService,
	teamCoordinator *team.Coordinator,
	messageRouter *team.MessageRouter,
) *WshRpcZeroaiServer {
	return &WshRpcZeroaiServer{
		sessionService:  sessionService,
		messageService:  messageService,
		agentService:    agentService,
		providerService: providerService,
		teamCoordinator: teamCoordinator,
		messageRouter:   messageRouter,
		defaultBackend:  "claude",
	}
}

// ZeroAiCreateSessionCommand creates a new ZeroAI session
func (zs *WshRpcZeroaiServer) ZeroAiCreateSessionCommand(ctx context.Context, req wshrpc.CommandZeroAiCreateSessionData) (wshrpc.CommandZeroAiCreateSessionRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiCreateSessionCommand", recover())
	}()

	opts := agent.AgentSessionOptions{
		Backend:       req.Backend,
		WorkDir:       req.WorkDir,
		Model:         req.Model,
		ResumeSession: false,
	}

	session, err := zs.sessionService.CreateSession(ctx, opts)
	if err != nil {
		return wshrpc.CommandZeroAiCreateSessionRtnData{}, err
	}

	return wshrpc.CommandZeroAiCreateSessionRtnData{
		SessionID: session.ID,
	}, nil
}

// ZeroAiGetSessionCommand retrieves a session by ID
func (zs *WshRpcZeroaiServer) ZeroAiGetSessionCommand(ctx context.Context, req wshrpc.CommandZeroAiGetSessionData) (wshrpc.ZeroAiSessionWrapper, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiGetSessionCommand", recover())
	}()

	session, err := zs.sessionService.GetSession(req.SessionID)
	if err != nil {
		return wshrpc.ZeroAiSessionWrapper{}, err
	}

	return toSessionWrapper(session), nil
}

// ZeroAiListSessionsCommand lists all sessions
func (zs *WshRpcZeroaiServer) ZeroAiListSessionsCommand(ctx context.Context, req wshrpc.CommandZeroAiListSessionsData) (wshrpc.CommandZeroAiListSessionsRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiListSessionsCommand", recover())
	}()

	sessions, err := zs.sessionService.ListSessions()
	if err != nil {
		return wshrpc.CommandZeroAiListSessionsRtnData{}, err
	}

	result := make([]*wshrpc.ZeroAiSessionInfo, len(sessions))
	for i, s := range sessions {
		result[i] = &wshrpc.ZeroAiSessionInfo{
			SessionID:     s.ID,
			Provider:      s.Backend,
			Model:         s.Model,
			WorkDir:       s.WorkDir,
			CreatedAt:     s.CreatedAt,
			LastMessageAt: 0, // TODO: Get from message store
		}
	}

	return wshrpc.CommandZeroAiListSessionsRtnData{
		Sessions: result,
	}, nil
}

// ZeroAiDeleteSessionCommand deletes a session
func (zs *WshRpcZeroaiServer) ZeroAiDeleteSessionCommand(ctx context.Context, req wshrpc.CommandZeroAiDeleteSessionData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiDeleteSessionCommand", recover())
	}()

	err := zs.sessionService.DeleteSession(req.SessionID)
	if err != nil {
		return err
	}

	// Delete session messages
	if zs.messageService != nil {
		if delErr := zs.messageService.DeleteSessionMessages(req.SessionID); delErr != nil {
			log.Printf("failed to delete session messages: %v", delErr)
		}
	}

	return nil
}

// ZeroAiSetWorkDirCommand sets the working directory for a session
func (zs *WshRpcZeroaiServer) ZeroAiSetWorkDirCommand(ctx context.Context, req wshrpc.CommandZeroAiSetWorkDirData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiSetWorkDirCommand", recover())
	}()

	return zs.sessionService.SetWorkDir(req.SessionID, req.WorkDir)
}

// ZeroAiSendMessageCommand sends a non-streaming message to the agent
func (zs *WshRpcZeroaiServer) getBackendForSession(ctx context.Context, sessionID string) string {
	session, err := zs.sessionService.GetSession(sessionID)
	if err != nil || session.Backend == "" {
		return zs.defaultBackend
	}
	return session.Backend
}

func (zs *WshRpcZeroaiServer) ZeroAiSendMessageCommand(ctx context.Context, req wshrpc.CommandZeroAiSendMessageData) (wshrpc.CommandZeroAiSendMessageRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiSendMessageCommand", recover())
	}()

	backend := zs.getBackendForSession(ctx, req.SessionID)
	agentConfig := agent.AgentConfig{
		Backend: backend,
	}

	ag, err := zs.agentService.GetAgent(ctx, agentConfig)
	if err != nil {
		return wshrpc.CommandZeroAiSendMessageRtnData{}, err
	}

	// Prepare send message input
	input := agent.SendMessageInput{
		Content: req.Content,
	}

	// Store user message
	userMsgID := zs.messageService.AddMessage(&store.Message{
		SessionID: req.SessionID,
		Role:      req.Role,
		Content:   req.Content,
	})
	var messageID int64
	if msgID, ok := userMsgID.(int64); ok {
		messageID = msgID
	}

	// Send message and collect events
	eventCh, err := ag.SendMessage(ctx, req.SessionID, input)
	if err != nil {
		return wshrpc.CommandZeroAiSendMessageRtnData{}, err
	}

	// Stream agent events to message store until end of turn
	for event := range eventCh {
		if zs.messageService != nil {
			zs.messageService.AddMessage(&store.Message{
				SessionID: req.SessionID,
				Role:      "assistant",
				Content:   eventDataToString(event.Data),
				EventType: string(event.Type),
			})
		}

		if event.Type == agent.EventTypeEndTurn {
			break
		}
	}

	return wshrpc.CommandZeroAiSendMessageRtnData{
		MessageID: messageID,
		Streaming: false,
	}, nil
}

// ZeroAiSendStreamMessageCommand sends a streaming message to the agent
func (zs *WshRpcZeroaiServer) ZeroAiSendStreamMessageCommand(ctx context.Context, req wshrpc.CommandZeroAiSendMessageData) chan wshrpc.RespOrErrorUnion[wshrpc.ZeroAiStreamMessageEvent] {
	defer func() {
		panichandler.PanicHandler("ZeroAiSendStreamMessageCommand", recover())
	}()

	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.ZeroAiStreamMessageEvent])

	go func() {
		defer close(rtn)

		backend := zs.getBackendForSession(ctx, req.SessionID)
		agentConfig := agent.AgentConfig{
			Backend: backend,
		}

		ag, err := zs.agentService.GetAgent(ctx, agentConfig)
		if err != nil {
			sendError(rtn, err)
			return
		}

		// Prepare send message input
		input := agent.SendMessageInput{
			Content: req.Content,
		}

		// Store user message
		if zs.messageService != nil {
			zs.messageService.AddMessage(&store.Message{
				SessionID: req.SessionID,
				Role:      req.Role,
				Content:   req.Content,
			})
		}

		// Send message and stream events
		eventCh, err := ag.SendMessage(ctx, req.SessionID, input)
		if err != nil {
			sendError(rtn, err)
			return
		}

		for event := range eventCh {
			// Check if context is canceled
			select {
			case <-ctx.Done():
				return
			default:
			}

			// Convert event to message wrapper
			msg := &wshrpc.ZeroAiMessageWrapper{
				SessionID: event.Session,
				Role:      "assistant",
				Content:   eventDataToString(event.Data),
				EventType: string(event.Type),
			}

			// Stream event to caller
			resp := wshrpc.RespOrErrorUnion[wshrpc.ZeroAiStreamMessageEvent]{}
			resp.Response.Message = msg
			rtn <- resp

			if event.Type == agent.EventTypeEndTurn {
				break
			}
		}
	}()

	return rtn
}

// ZeroAiGetMessagesCommand retrieves session messages
func (zs *WshRpcZeroaiServer) ZeroAiGetMessagesCommand(ctx context.Context, req wshrpc.CommandZeroAiGetMessagesData) (wshrpc.CommandZeroAiGetMessagesRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiGetMessagesCommand", recover())
	}()

	var messages []*store.Message
	if zs.messageService != nil {
		msgs, err := zs.messageService.GetSessionMessages(req.SessionID)
		if err != nil {
			return wshrpc.CommandZeroAiGetMessagesRtnData{}, err
		}
		messages = msgs
	}

	result := make([]*wshrpc.ZeroAiMessageInfo, len(messages))
	for i, msg := range messages {
		result[i] = &wshrpc.ZeroAiMessageInfo{
			ID:        msg.ID,
			SessionID: msg.SessionID,
			Role:      msg.Role,
			Content:   msg.Content,
			CreatedAt: msg.CreatedAt,
		}
	}

	return wshrpc.CommandZeroAiGetMessagesRtnData{
		Messages: result,
	}, nil
}

// ZeroAiGetAgentsCommand lists available agents
func (zs *WshRpcZeroaiServer) ZeroAiGetAgentsCommand(ctx context.Context, req wshrpc.CommandZeroAiGetAgentsData) ([]wshrpc.ZeroAiAgentInfo, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiGetAgentsCommand", recover())
	}()

	agents := zs.agentService.ListAgents()

	result := make([]wshrpc.ZeroAiAgentInfo, len(agents))
	for i, a := range agents {
		result[i] = wshrpc.ZeroAiAgentInfo{
			Backend:     a.Backend,
			Model:       a.Backend,
			Provider:    "cli",
			DisplayName: a.Backend,
			Description: a.CliPath,
			Enabled:     a.IsRunning,
		}
	}

	customProviders, _ := zs.providerService.ListProviders()
	for _, prov := range customProviders {
		result = append(result, wshrpc.ZeroAiAgentInfo{
			Backend:     prov.ID,
			Model:       prov.DefaultModel,
			Provider:    "custom",
			DisplayName: prov.DisplayName,
			Description: prov.CliCommand,
			Enabled:     prov.IsAvailable,
		})
	}

	return result, nil
}

// ZeroAiConfirmPermissionCommand confirms a permission request
func (zs *WshRpcZeroaiServer) ZeroAiConfirmPermissionCommand(ctx context.Context, req wshrpc.CommandZeroAiConfirmPermissionData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiConfirmPermissionCommand", recover())
	}()

	backend := zs.getBackendForSession(ctx, req.SessionID)
	agentConfig := agent.AgentConfig{
		Backend: backend,
	}

	ag, err := zs.agentService.GetAgent(ctx, agentConfig)
	if err != nil {
		return err
	}

	return ag.ConfirmPermission(ctx, req.SessionID, req.CallID, req.OptionID)
}

// toSessionWrapper converts session to wrapper
func toSessionWrapper(session *agent.AgentSession) wshrpc.ZeroAiSessionWrapper {
	return wshrpc.ZeroAiSessionWrapper{
		ID:            session.ID,
		Backend:       session.Backend,
		WorkDir:       session.WorkDir,
		Model:         session.Model,
		Provider:      session.Backend,
		ThinkingLevel: "",
		YoloMode:      false,
		SessionID:     session.ID,
		CreatedAt:     session.CreatedAt,
		UpdatedAt:     session.UpdatedAt,
	}
}

// eventDataToString converts event data to string
func eventDataToString(data interface{}) string {
	if data == nil {
		return ""
	}

	// If it's already a string, return it
	if str, ok := data.(string); ok {
		return str
	}

	// Try to marshal as JSON
	if bytes, err := json.Marshal(data); err == nil {
		return string(bytes)
	}

	return ""
}

// sendError sends an error event to the channel
func sendError(ch chan wshrpc.RespOrErrorUnion[wshrpc.ZeroAiStreamMessageEvent], err error) {
	resp := wshrpc.RespOrErrorUnion[wshrpc.ZeroAiStreamMessageEvent]{}
	resp.Error = err
	ch <- resp
}

func (zs *WshRpcZeroaiServer) ZeroAiListProvidersCommand(ctx context.Context, req wshrpc.CommandZeroAiListProvidersData) (wshrpc.CommandZeroAiListProvidersRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiListProvidersCommand", recover())
	}()

	providers, err := zs.providerService.ListProviders()
	if err != nil {
		return wshrpc.CommandZeroAiListProvidersRtnData{}, err
	}

	return wshrpc.CommandZeroAiListProvidersRtnData{
		Providers: providers,
	}, nil
}

func (zs *WshRpcZeroaiServer) ZeroAiSaveProviderCommand(ctx context.Context, req wshrpc.CommandZeroAiSaveProviderData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiSaveProviderCommand", recover())
	}()

	return zs.providerService.SaveProvider(req)
}

func (zs *WshRpcZeroaiServer) ZeroAiDeleteProviderCommand(ctx context.Context, req wshrpc.CommandZeroAiDeleteProviderData) error {
	defer func() {
		panichandler.PanicHandler("ZeroAiDeleteProviderCommand", recover())
	}()

	return zs.providerService.DeleteProvider(req.ProviderID)
}

func (zs *WshRpcZeroaiServer) ZeroAiTestProviderCommand(ctx context.Context, req wshrpc.CommandZeroAiTestProviderData) (wshrpc.CommandZeroAiTestProviderRtnData, error) {
	defer func() {
		panichandler.PanicHandler("ZeroAiTestProviderCommand", recover())
	}()

	result, err := zs.providerService.TestProvider(ctx, req.ProviderID)
	if err != nil {
		return wshrpc.CommandZeroAiTestProviderRtnData{}, err
	}

	return wshrpc.CommandZeroAiTestProviderRtnData{
		Result: result,
	}, nil
}
