// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// Backend implements aiusechat.UseChatBackend for the pi coding agent.
// It spawns pi as a subprocess and communicates via JSONL RPC mode,
// translating pi's events into waveterm SSE events.
type Backend struct {
	mgr *Manager

	mu sync.RWMutex
	// Per-RunChatStep state (protected by mu)
	currentTools    []piToolCall
	currentToolIdx map[string]int // toolCallID -> index
	accumulatedText    string
	accumulatedThinking string
	textID      string
	thinkingID  string
	toolResults []uctypes.AIToolResult
	stopReason  *uctypes.WaveStopReason
	streamErr   error

	// Persisted messages across the chat
	chatMessages []uctypes.GenAIMessage
}

// NewBackend creates a new pi Backend.
func NewBackend(mgr *Manager) *Backend {
	return &Backend{
		mgr:            mgr,
		currentToolIdx: make(map[string]int),
	}
}

// compile-time interface assertion
var _ interface{ UseChatBackendSelf() } = (*Backend)(nil)

func (b *Backend) UseChatBackendSelf() {}

// RunChatStep executes a single chat step. It sends a prompt to pi and
// streams back events as SSE data until a terminal stop reason is reached.
func (b *Backend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	b.resetTurnState()

	// Ensure the chat exists in the store
	aiChat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if aiChat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	// cont signals whether this is a fresh prompt or a continuation after tool use
	if cont != nil && cont.ContinueFromKind == uctypes.StopKindToolUse {
		// Send tool results as a follow_up
		b.mu.Lock()
		toolResults := make([]uctypes.AIToolResult, len(b.toolResults))
		copy(toolResults, b.toolResults)
		b.mu.Unlock()
		followUpText := b.buildToolResultsFollowUp(toolResults)
		if err := b.sendFollowUp(ctx, followUpText); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to send tool results: %w", err)
		}
	} else {
		// Get the next pending user message from the chat
		userMsg := b.getNextPendingUserMessage(aiChat)
		if userMsg == nil {
			return nil, nil, nil, fmt.Errorf("no pending user messages")
		}
		if err := b.sendPromptFromAIMessage(ctx, userMsg); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to send prompt: %w", err)
		}
	}

	// Register for events from pi
	events := b.mgr.RegisterEventListener()
	defer b.mgr.UnregisterEventListener(events)

	// Reset SSE state IDs
	b.mu.Lock()
	b.textID = uuid.New().String()
	b.thinkingID = uuid.New().String()
	b.mu.Unlock()

	// Process event stream
	for {
		select {
		case <-ctx.Done():
			b.abort()
			return nil, nil, nil, ctx.Err()
		case ev, ok := <-events:
			if !ok {
				// pi process ended
				return b.stopReason, b.chatMessages, nil, b.streamErr
			}
			stopReason, err := b.handleEvent(ctx, ev, sseHandler, chatOpts)
			if stopReason != nil {
				b.stopReason = stopReason
			}
			if err != nil {
				b.streamErr = err
			}
			if stopReason != nil && stopReason.Kind != "" {
				return b.stopReason, b.chatMessages, nil, nil
			}
		}
	}
}

// getNextPendingUserMessage finds the last user message in the chat.
// pi will then be asked to respond to it.
func (b *Backend) getNextPendingUserMessage(aiChat *uctypes.AIChat) *uctypes.AIMessage {
	var lastUser *uctypes.AIMessage
	for _, msg := range aiChat.NativeMessages {
		if msg.GetRole() == "user" {
			if genMsg, ok := msg.(*genAIMessage); ok {
				lastUser = genMsg.toAIMessage()
			}
		}
	}
	return lastUser
}

// sendPrompt sends a plain text prompt to pi.
func (b *Backend) sendPrompt(ctx context.Context, message string) error {
	cmd := RPCCommand{
		Type:    RPCmdPrompt,
		Message: message,
	}
	_, err := b.mgr.SendCommandAsync(cmd)
	return err
}

// sendFollowUp sends a follow_up message to pi (used for tool results).
func (b *Backend) sendFollowUp(ctx context.Context, text string) error {
	cmd := RPCCommand{
		Type:    RPCmdFollowUp,
		Message: text,
	}
	_, err := b.mgr.SendCommandAsync(cmd)
	return err
}

// sendPromptFromAIMessage converts a waveterm AIMessage to a pi prompt and sends it.
func (b *Backend) sendPromptFromAIMessage(ctx context.Context, msg *uctypes.AIMessage) error {
	var textParts []string
	var images []RPCImage

	for _, part := range msg.Parts {
		switch part.Type {
		case uctypes.AIMessagePartTypeText:
			textParts = append(textParts, part.Text)
		case uctypes.AIMessagePartTypeFile:
			if part.MimeType != "" && len(part.Data) > 0 {
				images = append(images, RPCImage{
					Type:     "image",
					Data:     string(part.Data),
					MimeType: part.MimeType,
				})
			}
		}
	}

	cmd := RPCCommand{
		Type:    RPCmdPrompt,
		Message: strings.Join(textParts, ""),
		Images:  images,
	}
	_, err := b.mgr.SendCommandAsync(cmd)
	return err
}

// buildToolResultsFollowUp builds a text summary of tool results for pi.
func (b *Backend) buildToolResultsFollowUp(results []uctypes.AIToolResult) string {
	if len(results) == 0 {
		return ""
	}
	var lines []string
	for _, r := range results {
		if r.ErrorText != "" {
			lines = append(lines, fmt.Sprintf("Tool %s error: %s", r.ToolName, r.ErrorText))
		} else {
			text := r.Text
			if len(text) > 500 {
				text = text[:500] + "..."
			}
			lines = append(lines, fmt.Sprintf("Tool %s result: %s", r.ToolName, text))
		}
	}
	return strings.Join(lines, "\n")
}

// resetTurnState resets per-turn state for a new LLM call.
func (b *Backend) resetTurnState() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.currentTools = nil
	b.currentToolIdx = make(map[string]int)
	b.stopReason = nil
	b.accumulatedText = ""
	b.accumulatedThinking = ""
	b.toolResults = nil
	b.streamErr = nil
}

// handleEvent processes a single pi RPC event and emits SSE events.
func (b *Backend) handleEvent(
	ctx context.Context,
	ev RPCEvent,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
) (*uctypes.WaveStopReason, error) {
	evType := ev.EventType()

	switch evType {
	case RPCEventAgentStart:
		return nil, nil

	case RPCEventAgentEnd:
		b.mu.Lock()
		if b.stopReason == nil {
			b.stopReason = &uctypes.WaveStopReason{Kind: piStopReasonDone}
		}
		b.finalizeCurrentMessage(sseHandler)
		b.mu.Unlock()
		return b.stopReason, nil

	case RPCEventMessageStart:
		b.mu.Lock()
		b.accumulatedText = ""
		b.accumulatedThinking = ""
		b.currentTools = nil
		b.currentToolIdx = make(map[string]int)
		b.mu.Unlock()
		_ = sseHandler.AiMsgStart(uuid.New().String())
		return nil, nil

	case RPCEventMessageUpdate:
		b.handleMessageUpdate(ev, sseHandler)
		return nil, nil

	case RPCEventMessageEnd:
		b.mu.Lock()
		b.finalizeCurrentMessage(sseHandler)
		b.mu.Unlock()
		return nil, nil

	case RPCEventTurnStart:
		b.mu.Lock()
		b.accumulatedText = ""
		b.accumulatedThinking = ""
		b.currentTools = nil
		b.currentToolIdx = make(map[string]int)
		b.mu.Unlock()
		_ = sseHandler.AiMsgStartStep()
		return nil, nil

	case RPCEventTurnEnd:
		b.mu.Lock()
		data := ev.GetMap("data")
		if data == nil {
			data = ev
		}
		toolResults := b.decodeTurnEndToolResults(data)
		b.toolResults = append(b.toolResults, toolResults...)
		b.mu.Unlock()

		for _, tr := range toolResults {
			toolUseData := aiutil.CreateToolUseData(tr.ToolUseID, tr.ToolName, "", chatOpts)
			if tr.ErrorText != "" {
				toolUseData.Status = uctypes.ToolUseStatusError
				toolUseData.ErrorMessage = tr.ErrorText
			} else {
				toolUseData.Status = uctypes.ToolUseStatusCompleted
			}
			_ = sseHandler.AiMsgData("data-tooluse", tr.ToolUseID, toolUseData)
		}
		_ = sseHandler.AiMsgFinishStep()
		return nil, nil

	case RPCEventToolExecutionStart:
		toolCallID := ev.GetString("toolCallId")
		toolName := ev.GetString("toolName")
		argsMap := ev.GetAny("args")
		argsJSON, _ := json.Marshal(argsMap)

		b.mu.Lock()
		idx := len(b.currentTools)
		b.currentTools = append(b.currentTools, piToolCall{ID: toolCallID, Name: toolName, Input: argsMap})
		b.currentToolIdx[toolCallID] = idx
		b.mu.Unlock()

		toolUseData := aiutil.CreateToolUseData(toolCallID, toolName, string(argsJSON), chatOpts)
		toolUseData.Status = uctypes.ToolUseStatusPending
		if !b.shouldAutoApprove(toolName) {
			toolUseData.Approval = uctypes.ApprovalNeedsApproval
		}
		_ = sseHandler.AiMsgData("data-tooluse", toolCallID, toolUseData)
		return nil, nil

	case RPCEventToolExecutionUpdate:
		toolCallID := ev.GetString("toolCallId")
		partialMap := ev.GetMap("partialResult")
		if partialMap == nil {
			return nil, nil
		}
		contentList := b.decodeToolContent(partialMap)
		statusLines := make([]string, 0, len(contentList))
		for _, c := range contentList {
			statusLines = append(statusLines, c.Text)
		}
		_ = sseHandler.AiMsgData("data-toolprogress", toolCallID, map[string]any{
			"toolcallid":  toolCallID,
			"toolname":    ev.GetString("toolName"),
			"statuslines": statusLines,
		})
		return nil, nil

	case RPCEventToolExecutionEnd:
		toolCallID := ev.GetString("toolCallId")
		toolName := ev.GetString("toolName")
		isError := ev.GetBool("isError")
		resultMap := ev.GetAny("result")

		var resultText string
		if resultMap != nil {
			contentList := b.decodeToolContent(resultMap)
			for _, c := range contentList {
				resultText += c.Text
			}
		}

		toolUseData := aiutil.CreateToolUseData(toolCallID, toolName, "", chatOpts)
		if isError {
			toolUseData.Status = uctypes.ToolUseStatusError
			toolUseData.ErrorMessage = resultText
		} else {
			toolUseData.Status = uctypes.ToolUseStatusCompleted
			toolUseData.ToolDesc = toolName + " completed"
		}
		_ = sseHandler.AiMsgData("data-tooluse", toolCallID, toolUseData)

		aiResult := uctypes.AIToolResult{
			ToolName:  toolName,
			ToolUseID: toolCallID,
			Text:      resultText,
		}
		if isError {
			aiResult.ErrorText = resultText
		}
		b.mu.Lock()
		b.toolResults = append(b.toolResults, aiResult)
		b.mu.Unlock()
		return nil, nil

	case RPCEventQueueUpdate,
		RPCEventCompactionStart,
		RPCEventCompactionEnd:
		return nil, nil

	case RPCEventAutoRetryStart:
		delayMs := ev.GetInt("delayMs")
		msg := fmt.Sprintf("Retrying after %dms (attempt %d)...", delayMs, ev.GetInt("attempt"))
		_ = sseHandler.WriteData(msg)
		return nil, nil

	case RPCEventAutoRetryEnd:
		if ev.GetBool("success") {
			return nil, nil
		}
		finalErr := ev.GetString("finalError")
		b.mu.Lock()
		b.stopReason = &uctypes.WaveStopReason{Kind: piStopReasonError, ErrorText: finalErr}
		b.mu.Unlock()
		_ = sseHandler.AiMsgError(finalErr)
		return b.stopReason, nil

	case RPCEventExtensionError:
		extPath := ev.GetString("extensionPath")
		errMsg := ev.GetString("error")
		_ = sseHandler.AiMsgError(fmt.Sprintf("Extension error in %s: %s", extPath, errMsg))
		return nil, nil

	case RPCEventExtensionUIRequest:
		// pi is requesting UI interaction (select, confirm, etc.)
		reqID, _ := ev["id"].(string)
		method, _ := ev["method"].(string)
		title, _ := ev["title"].(string)
		_ = sseHandler.AiMsgData("data-extui", reqID, map[string]any{
			"method": method,
			"title":  title,
			"id":     reqID,
		})
		return nil, nil

	default:
		return nil, nil
	}
}

// handleMessageUpdate processes message_update events which contain streaming deltas.
func (b *Backend) handleMessageUpdate(ev RPCEvent, sseHandler *sse.SSEHandlerCh) {
	evtData := ev.GetAny("assistantMessageEvent")
	if evtData == nil {
		return
	}
	evtMap, ok := evtData.(map[string]any)
	if !ok {
		return
	}
	evtType, _ := evtMap["type"].(string)

	switch evtType {
	case "text_start":
		b.mu.Lock()
		b.textID = uuid.New().String()
		textID := b.textID
		b.mu.Unlock()
		_ = sseHandler.AiMsgTextStart(textID)

	case "text_delta":
		delta, _ := evtMap["delta"].(string)
		if delta == "" {
			delta, _ = evtMap["textDelta"].(string)
		}
		if delta != "" {
			b.mu.Lock()
			b.accumulatedText += delta
			textID := b.textID
			b.mu.Unlock()
			_ = sseHandler.AiMsgTextDelta(textID, delta)
		}

	case "text_end":
		b.mu.Lock()
		textID := b.textID
		b.mu.Unlock()
		_ = sseHandler.AiMsgTextEnd(textID)

	case "thinking_start":
		b.mu.Lock()
		b.thinkingID = uuid.New().String()
		thinkingID := b.thinkingID
		b.mu.Unlock()
		_ = sseHandler.AiMsgReasoningStart(thinkingID)

	case "thinking_delta":
		delta, _ := evtMap["delta"].(string)
		if delta == "" {
			delta, _ = evtMap["thinkingDelta"].(string)
		}
		if delta != "" {
			b.mu.Lock()
			b.accumulatedThinking += delta
			thinkingID := b.thinkingID
			b.mu.Unlock()
			_ = sseHandler.AiMsgReasoningDelta(thinkingID, delta)
		}

	case "thinking_end":
		b.mu.Lock()
		thinkingID := b.thinkingID
		b.mu.Unlock()
		_ = sseHandler.AiMsgReasoningEnd(thinkingID)

	case "toolcall_delta":
		// Partial tool call — emit delta through the text channel
		delta, _ := evtMap["delta"].(string)
		if delta != "" {
			b.mu.Lock()
			textID := b.textID
			b.mu.Unlock()
			_ = sseHandler.AiMsgTextDelta(textID, delta)
		}

	case "toolcall_end":
		partialMap := evtMap["partial"]
		if pm, ok := partialMap.(map[string]any); ok {
			contentList, _ := pm["content"].([]any)
			if contentList != nil {
				for _, cb := range contentList {
					if cbMap, ok := cb.(map[string]any); ok {
						if tc, ok := cbMap["toolCall"].(map[string]any); ok {
							toolCallID, _ := tc["id"].(string)
							toolName, _ := tc["name"].(string)
							toolInput := tc["input"]
							inputJSON, _ := json.Marshal(toolInput)

							b.mu.Lock()
							idx := len(b.currentTools)
							b.currentTools = append(b.currentTools, piToolCall{
								ID:    toolCallID,
								Name:  toolName,
								Input: toolInput,
							})
							b.currentToolIdx[toolCallID] = idx
							b.mu.Unlock()

							toolUseData := aiutil.CreateToolUseData(toolCallID, toolName, string(inputJSON), uctypes.WaveChatOpts{})
							toolUseData.Status = uctypes.ToolUseStatusPending
							_ = sseHandler.AiMsgData("data-tooluse", toolCallID, toolUseData)
						}
					}
				}
			}
		}

	case "done":
		reason, _ := evtMap["reason"].(string)
		b.mu.Lock()
		if b.stopReason == nil {
			b.stopReason = b.makeStopReason(reason)
		}
		b.mu.Unlock()
		// Signal end of message
		b.mu.Lock()
		textID := b.textID
		thinkingID := b.thinkingID
		b.mu.Unlock()
		if textID != "" {
			_ = sseHandler.AiMsgTextEnd(textID)
		}
		if thinkingID != "" {
			_ = sseHandler.AiMsgReasoningEnd(thinkingID)
		}
	}
}

// shouldAutoApprove returns true for read-only tools that should auto-approve.
func (b *Backend) shouldAutoApprove(toolName string) bool {
	readonlyTools := map[string]bool{
		"read":             true,
		"read_file":        true,
		"read_dir":         true,
		"read_dir_tree":    true,
		"grep":             true,
		"find":             true,
		"ls":               true,
		"screenshot":       true,
		"web_search":       true,
		"web_fetch":        true,
		"get_session_stats": true,
		"get_state":        true,
		"get_messages":     true,
	}
	return readonlyTools[toolName]
}

// makeStopReason converts a pi done reason to a WaveStopReason.
func (b *Backend) makeStopReason(reason string) *uctypes.WaveStopReason {
	var kind uctypes.StopReasonKind
	switch reason {
	case "stop":
		kind = piStopReasonDone
	case "toolUse":
		kind = piStopReasonToolUse
	case "length":
		kind = piStopReasonMaxTokens
	case "error":
		kind = piStopReasonError
	case "aborted":
		kind = piStopReasonAborted
	default:
		kind = piStopReasonDone
	}

	sr := &uctypes.WaveStopReason{Kind: kind}

	if kind == piStopReasonToolUse {
		b.mu.RLock()
		var toolCalls []uctypes.WaveToolCall
		for _, tc := range b.currentTools {
			toolCalls = append(toolCalls, uctypes.WaveToolCall{
				ID:    tc.ID,
				Name:  tc.Name,
				Input: tc.Input,
			})
		}
		b.mu.RUnlock()
		sr.ToolCalls = toolCalls
	}

	return sr
}

// finalizeCurrentMessage builds the current assistant message and appends it to chatMessages.
func (b *Backend) finalizeCurrentMessage(sseHandler *sse.SSEHandlerCh) {
	if b.accumulatedText == "" && b.accumulatedThinking == "" && len(b.currentTools) == 0 {
		return
	}

	msg := &genAIMessage{
		id:         uuid.New().String(),
		role:       "assistant",
		text:       b.accumulatedText,
		thinking:   b.accumulatedThinking,
		stopReason: b.stopReasonKindToString(),
	}
	// Attach tool calls
	for _, tc := range b.currentTools {
		msg.toolCalls = append(msg.toolCalls, uctypes.WaveToolCall{
			ID:    tc.ID,
			Name:  tc.Name,
			Input: tc.Input,
		})
	}

	b.chatMessages = append(b.chatMessages, msg)

	// Emit finish
	_ = sseHandler.AiMsgFinish(msg.stopReason, nil)
}

func (b *Backend) stopReasonKindToString() string {
	if b.stopReason == nil {
		return "stop"
	}
	switch b.stopReason.Kind {
	case piStopReasonToolUse:
		return "toolUse"
	case piStopReasonMaxTokens:
		return "length"
	case piStopReasonError:
		return "error"
	case piStopReasonAborted:
		return "aborted"
	default:
		return "stop"
	}
}

// decodeTurnEndToolResults decodes tool results from a turn_end event.
func (b *Backend) decodeTurnEndToolResults(data map[string]any) []uctypes.AIToolResult {
	var results []uctypes.AIToolResult
	toolResultsList, ok := data["toolResults"].([]any)
	if !ok {
		return results
	}
	for _, tr := range toolResultsList {
		if trMap, ok := tr.(map[string]any); ok {
			toolCallID, _ := trMap["toolCallId"].(string)
			toolName, _ := trMap["toolName"].(string)
			isError, _ := trMap["isError"].(bool)
			var text string
			if contentList, ok := trMap["content"].([]any); ok {
				for _, c := range contentList {
					if cMap, ok := c.(map[string]any); ok {
						if t, ok := cMap["text"].(string); ok {
							text += t
						}
					}
				}
			}
			result := uctypes.AIToolResult{
				ToolName:  toolName,
				ToolUseID: toolCallID,
				Text:      text,
			}
			if isError {
				result.ErrorText = text
			}
			results = append(results, result)
		}
	}
	return results
}

// decodeToolContent decodes the content list from a tool result.
func (b *Backend) decodeToolContent(v any) []piToolContent {
	if v == nil {
		return nil
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	contentList, ok := m["content"].([]any)
	if !ok {
		return nil
	}
	var results []piToolContent
	for _, c := range contentList {
		if cMap, ok := c.(map[string]any); ok {
			content := piToolContent{Type: "text"}
			if t, ok := cMap["text"].(string); ok {
				content.Text = t
			}
			results = append(results, content)
		}
	}
	return results
}

// abort sends an abort command to pi.
func (b *Backend) abort() {
	b.mgr.SendCommand(context.Background(), RPCCommand{Type: RPCmdAbort})
}

// UpdateToolUseData is a no-op for pi — pi manages its own session state.
func (b *Backend) UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return nil
}

// RemoveToolUseCall is a no-op for pi.
func (b *Backend) RemoveToolUseCall(chatId string, toolCallId string) error {
	return nil
}

// ConvertToolResultsToNativeChatMessage converts waveterm tool results to native messages.
// For pi, tool results are sent as follow_up messages via the RPC protocol,
// not as native chat messages. This returns nil.
func (b *Backend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return nil, nil
}

// ConvertAIMessageToNativeChatMessage converts a waveterm AIMessage to a native message.
func (b *Backend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	var textParts []string
	for _, part := range message.Parts {
		if part.Type == uctypes.AIMessagePartTypeText {
			textParts = append(textParts, part.Text)
		}
	}
	return &genAIMessage{
		id:     message.MessageId,
		role:   "user",
		text:   strings.Join(textParts, ""),
	}, nil
}

// GetFunctionCallInputByToolCallId retrieves a function call from the chat history.
func (b *Backend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, msg := range b.chatMessages {
		if asstMsg, ok := msg.(*genAIMessage); ok {
			for _, tc := range asstMsg.toolCalls {
				if tc.ID == toolCallId {
					inputJSON, _ := json.Marshal(tc.Input)
					return &uctypes.AIFunctionCallInput{
						CallId:    tc.ID,
						Name:      tc.Name,
						Arguments: string(inputJSON),
					}
				}
			}
		}
	}
	return nil
}

// ConvertAIChatToUIChat is not yet implemented.
func (b *Backend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return nil, fmt.Errorf("ConvertAIChatToUIChat not yet implemented for pi backend")
}

// --- genAIMessage: pi-native message type that implements GenAIMessage ---

type genAIMessage struct {
	id         string
	role       string
	text       string
	thinking   string
	toolCalls  []uctypes.WaveToolCall
	stopReason string
}

func (m *genAIMessage) GetMessageId() string { return m.id }
func (m *genAIMessage) GetRole() string     { return m.role }
func (m *genAIMessage) GetUsage() *uctypes.AIUsage {
	return nil // pi doesn't expose usage to the host app in this integration pattern
}

func (m *genAIMessage) toAIMessage() *uctypes.AIMessage {
	parts := []uctypes.AIMessagePart{}
	if m.text != "" {
		parts = append(parts, uctypes.AIMessagePart{
			Type: uctypes.AIMessagePartTypeText,
			Text: m.text,
		})
	}
	return &uctypes.AIMessage{
		MessageId: m.id,
		Parts:     parts,
	}
}
