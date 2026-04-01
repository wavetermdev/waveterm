// Package protocol provides ACP (Agent Control Protocol) adapters for converting
// between ACP protocol messages and internal ZeroAI types.
package protocol

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/zeroai/types"
)

// ConvertResult is the result of an ACP message conversion
type ConvertResult struct {
	// Event is the internal ZeroAiEvent
	Event *types.ZeroAiEvent
	// Error contains any conversion error
	Error error
}

// AcpAdapter converts ACP protocol messages to internal ZeroAI types
type AcpAdapter struct{}

// NewAcpAdapter creates a new ACP adapter instance
func NewAcpAdapter() *AcpAdapter {
	return &AcpAdapter{}
}

// ConvertNotification converts an ACP notification to an internal ZeroAiEvent
func (a *AcpAdapter) ConvertNotification(notification *AcpNotification) *ConvertResult {
	if notification == nil {
		return &ConvertResult{Error: fmt.Errorf("notification is nil")}
	}

	switch notification.Method {
	case "session/update":
		return a.ConvertSessionUpdate(notification.Params)
	case "toolCall":
		return a.ConvertToolCallUpdate(notification.Params)
	case "permissionRequest":
		return a.ConvertPermissionRequest(notification.Params)
	case "planUpdate":
		return a.ConvertPlanUpdate(notification.Params)
	default:
		return &ConvertResult{Error: fmt.Errorf("unknown notification method: %s", notification.Method)}
	}
}

// ConvertSessionUpdate converts a session update notification to an internal event
func (a *AcpAdapter) ConvertSessionUpdate(params map[string]interface{}) *ConvertResult {
	if params == nil {
		return &ConvertResult{Error: fmt.Errorf("session update params is nil")}
	}

	sessionID, ok := params["session"].(string)
	if !ok {
		return &ConvertResult{Error: fmt.Errorf("session ID missing or not a string")}
	}

	updateType, ok := params["type"].(string)
	if !ok {
		return &ConvertResult{Error: fmt.Errorf("update type missing or not a string")}
	}

	content, _ := params["content"].(string)
	metadata, _ := params["metadata"].(map[string]interface{})

	var interfaceData interface{}

	switch updateType {
	case "text_chunk":
		// Text content chunk
		interfaceData = types.ZeroAiSessionChunk{
			Content:  content,
			Metadata: metadata,
		}

	case "tool_call":
		// Tool call event
		toolCall, err := a.extractToolCall(params)
		if err != nil {
			return &ConvertResult{Error: err}
		}
		interfaceData = types.ZeroAiToolCallData{
			ToolName:    toolCall.ToolName,
			CallID:      toolCall.CallID,
			Description: toolCall.Description,
		}

	case "permission":
		// Permission request
		permData, err := a.extractPermissionData(params)
		if err != nil {
			return &ConvertResult{Error: err}
		}
		interfaceData = *permData

	case "plan":
		// Plan update
		interfaceData = types.ZeroAiPlanUpdate{
			Content:  content,
			Metadata: metadata,
		}

	default:
		interfaceData = types.ZeroAiSessionChunk{
			Content:  content,
			Metadata: metadata,
		}
	}

	return &ConvertResult{
		Event: &types.ZeroAiEvent{
			Type:    updateType,
			Session: sessionID,
			Data:    interfaceData,
			Created: 0, // Set by caller
		},
	}
}

// ConvertSessionUpdateChunk converts a session update chunk specifically
func (a *AcpAdapter) ConvertSessionUpdateChunk(params map[string]interface{}) *ConvertResult {
	if params == nil {
		return &ConvertResult{Error: fmt.Errorf("session update chunk params is nil")}
	}

	sessionID, ok := params["session"].(string)
	if !ok {
		return &ConvertResult{Error: fmt.Errorf("session ID missing or not a string")}
	}

	content, _ := params["content"].(string)
	metadata, _ := params["metadata"].(map[string]interface{})

	return &ConvertResult{
		Event: &types.ZeroAiEvent{
			Type:    "text_chunk",
			Session: sessionID,
			Data: types.ZeroAiSessionChunk{
				Content:  content,
				Metadata: metadata,
			},
			Created: 0,
		},
	}
}

// ConvertToolCallUpdate converts an ACP tool call notification to an internal event
func (a *AcpAdapter) ConvertToolCallUpdate(params map[string]interface{}) *ConvertResult {
	if params == nil {
		return &ConvertResult{Error: fmt.Errorf("tool call params is nil")}
	}

	sessionID, ok := params["session"].(string)
	if !ok {
		return &ConvertResult{Error: fmt.Errorf("session ID missing or not a string")}
	}

	toolCall, err := a.extractToolCall(params)
	if err != nil {
		return &ConvertResult{Error: err}
	}

	// Determine the event type based on tool call metadata
	eventType := "tool_call"
	if status, exists := params["status"].(string); exists {
		switch status {
		case "started":
			eventType = "tool_started"
		case "completed":
			eventType = "tool_completed"
		case "failed":
			eventType = "tool_failed"
		}
	}

	return &ConvertResult{
		Event: &types.ZeroAiEvent{
			Type:    eventType,
			Session: sessionID,
			Data: types.ZeroAiToolCallData{
				ToolName:    toolCall.ToolName,
				CallID:      toolCall.CallID,
				Description: toolCall.Description,
			},
			Created: 0,
		},
	}
}

// ConvertToolCall converts a standalone ACP tool call to internal format
func (a *AcpAdapter) ConvertToolCall(toolCall *AcpToolCall) types.ZeroAiToolCallData {
	return types.ZeroAiToolCallData{
		ToolName:    toolCall.ToolName,
		CallID:      toolCall.CallID,
		Description: toolCall.Description,
	}
}

// ConvertPermissionRequest converts an ACP permission request to an internal event
func (a *AcpAdapter) ConvertPermissionRequest(params map[string]interface{}) *ConvertResult {
	if params == nil {
		return &ConvertResult{Error: fmt.Errorf("permission request params is nil")}
	}

	sessionID, ok := params["session"].(string)
	if !ok {
		return &ConvertResult{Error: fmt.Errorf("session ID missing or not a string")}
	}

	permData, err := a.extractPermissionData(params)
	if err != nil {
		return &ConvertResult{Error: err}
	}

	return &ConvertResult{
		Event: &types.ZeroAiEvent{
			Type:    "permission_request",
			Session: sessionID,
			Data:    *permData,
			Created: 0,
		},
	}
}

// ConvertPermission converts an ACP permission request to internal format
func (a *AcpAdapter) ConvertPermission(perm *AcpPermissionRequest) types.ZeroAiPermissionData {
	options := make([]types.PermissionOption, len(perm.Options))
	for i, opt := range perm.Options {
		options[i] = a.convertAcpOption(opt)
	}

	return types.ZeroAiPermissionData{
		CallID:      perm.CallID,
		ToolName:    perm.ToolName,
		Description: perm.Description,
		Options:     options,
	}
}

// ConvertPlanUpdate converts an ACP plan update to an internal event
func (a *AcpAdapter) ConvertPlanUpdate(params map[string]interface{}) *ConvertResult {
	if params == nil {
		return &ConvertResult{Error: fmt.Errorf("plan update params is nil")}
	}

	sessionID, ok := params["session"].(string)
	if !ok {
		return &ConvertResult{Error: fmt.Errorf("session ID missing or not a string")}
	}

	content, _ := params["content"].(string)
	metadata, _ := params["metadata"].(map[string]interface{})

	return &ConvertResult{
		Event: &types.ZeroAiEvent{
			Type:    "plan_update",
			Session: sessionID,
			Data: types.ZeroAiPlanUpdate{
				Content:  content,
				Metadata: metadata,
			},
			Created: 0,
		},
	}
}

// ConvertSessionUpdateFromAcp converts an AcpSessionUpdate to internal event
func (a *AcpAdapter) ConvertSessionUpdateFromAcp(update *AcpSessionUpdate, sessionID string) *ConvertResult {
	if update == nil {
		return &ConvertResult{Error: fmt.Errorf("session update is nil")}
	}

	var interfaceData interface{}
	var eventType string

	switch update.SessionUpdate {
	case "text":
		eventType = "text_chunk"
		interfaceData = types.ZeroAiSessionChunk{
			Content:  update.Content,
			Metadata: update.Metadata,
		}

	case "tool_call":
		eventType = "tool_call"
		if update.ToolCall != nil {
			interfaceData = a.ConvertToolCall(update.ToolCall)
		} else {
			return &ConvertResult{Error: fmt.Errorf("tool_call update missing toolCall field")}
		}

	case "permission":
		eventType = "permission_request"
		if update.Permission != nil {
			interfaceData = a.ConvertPermission(update.Permission)
		} else {
			return &ConvertResult{Error: fmt.Errorf("permission update missing permission field")}
		}

	default:
		eventType = update.SessionUpdate
		interfaceData = types.ZeroAiSessionChunk{
			Content:  update.Content,
			Metadata: update.Metadata,
		}
	}

	return &ConvertResult{
		Event: &types.ZeroAiEvent{
			Type:    eventType,
			Session: sessionID,
			Data:    interfaceData,
			Created: 0,
		},
	}
}

// extractToolCall extracts tool call data from params
func (a *AcpAdapter) extractToolCall(params map[string]interface{}) (*AcpToolCall, error) {
	// Try to get tool call directly
	if toolCallMap, ok := params["toolCall"].(map[string]interface{}); ok {
		callID := getString(toolCallMap, "callId")
		toolName := getString(toolCallMap, "toolName")
		description := getString(toolCallMap, "description")

		if callID == "" {
			return nil, fmt.Errorf("tool call missing callId")
		}
		if toolName == "" {
			return nil, fmt.Errorf("tool call missing toolName")
		}

		return &AcpToolCall{
			CallID:      callID,
			ToolName:    toolName,
			Description: description,
		}, nil
	}

	// Try to get from flat params
	callID := getString(params, "callId")
	toolName := getString(params, "toolName")
	description := getString(params, "description")

	if callID == "" {
		return nil, fmt.Errorf("tool call missing callId")
	}
	if toolName == "" {
		return nil, fmt.Errorf("tool call missing toolName")
	}

	return &AcpToolCall{
		CallID:      callID,
		ToolName:    toolName,
		Description: description,
	}, nil
}

// extractPermissionData extracts permission data from params
func (a *AcpAdapter) extractPermissionData(params map[string]interface{}) (*types.ZeroAiPermissionData, error) {
	// Try to get permission directly
	if permMap, ok := params["permission"].(map[string]interface{}); ok {
		return a.extractPermissionFromMap(permMap)
	}

	// Try to get from flat params
	callID := getString(params, "callId")
	toolName := getString(params, "toolName")
	description := getString(params, "description")

	if callID == "" {
		return nil, fmt.Errorf("permission missing callId")
	}
	if toolName == "" {
		return nil, fmt.Errorf("permission missing toolName")
	}

	options := make([]types.PermissionOption, 0)
	if optsArr, ok := params["options"].([]interface{}); ok {
		for _, opt := range optsArr {
			if optMap, ok := opt.(map[string]interface{}); ok {
				options = append(options, a.extractOptionFromMap(optMap))
			}
		}
	}

	return &types.ZeroAiPermissionData{
		CallID:      callID,
		ToolName:    toolName,
		Description: description,
		Options:     options,
	}, nil
}

// extractPermissionFromMap extracts permission from a map
func (a *AcpAdapter) extractPermissionFromMap(permMap map[string]interface{}) (*types.ZeroAiPermissionData, error) {
	callID := getString(permMap, "callId")
	toolName := getString(permMap, "toolName")
	description := getString(permMap, "description")

	if callID == "" {
		return nil, fmt.Errorf("permission missing callId")
	}
	if toolName == "" {
		return nil, fmt.Errorf("permission missing toolName")
	}

	options := make([]types.PermissionOption, 0)
	if optsArr, ok := permMap["options"].([]interface{}); ok {
		for _, opt := range optsArr {
			if optMap, ok := opt.(map[string]interface{}); ok {
				options = append(options, a.extractOptionFromMap(optMap))
			}
		}
	}

	return &types.ZeroAiPermissionData{
		CallID:      callID,
		ToolName:    toolName,
		Description: description,
		Options:     options,
	}, nil
}

// extractOptionFromMap extracts an option from a map
func (a *AcpAdapter) extractOptionFromMap(optMap map[string]interface{}) types.PermissionOption {
	return types.PermissionOption{
		ID:          getString(optMap, "id"),
		Label:       getString(optMap, "label"),
		Description: getString(optMap, "description"),
	}
}

// convertAcpOptions converts ACP options to internal options
func (a *AcpAdapter) convertAcpOptions(acpOptions []AcpOption) []types.PermissionOption {
	options := make([]types.PermissionOption, len(acpOptions))
	for i, opt := range acpOptions {
		options[i] = a.convertAcpOption(opt)
	}
	return options
}

// convertAcpOption converts a single ACP option to internal option
func (a *AcpAdapter) convertAcpOption(acpOpt AcpOption) types.PermissionOption {
	return types.PermissionOption{
		ID:          acpOpt.ID,
		Label:       acpOpt.Label,
		Description: acpOpt.Description,
	}
}

// getString safely extracts a string value from a map
func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return ""
}

// GetUpdateType extracts the update type from session update
func (a *AcpAdapter) GetUpdateType(params map[string]interface{}) string {
	if params == nil {
		return "unknown"
	}
	if typ, ok := params["type"].(string); ok {
		return typ
	}
	if update, ok := params["sessionUpdate"].(string); ok {
		return update
	}
	return "unknown"
}

// IsToolCallUpdate checks if the update contains a tool call
func (a *AcpAdapter) IsToolCallUpdate(params map[string]interface{}) bool {
	if params == nil {
		return false
	}
	updateType := a.GetUpdateType(params)
	return updateType == "tool_call" || params["toolCall"] != nil
}

// IsPermissionUpdate checks if the update contains a permission request
func (a *AcpAdapter) IsPermissionUpdate(params map[string]interface{}) bool {
	if params == nil {
		return false
	}
	updateType := a.GetUpdateType(params)
	return updateType == "permission" || params["permission"] != nil
}

// IsTextChunk checks if the update is a text content chunk
func (a *AcpAdapter) IsTextChunk(params map[string]interface{}) bool {
	if params == nil {
		return false
	}
	return a.GetUpdateType(params) == "text"
}

// IsPlanUpdate checks if the update is a plan update
func (a *AcpAdapter) IsPlanUpdate(params map[string]interface{}) bool {
	if params == nil {
		return false
	}
	return a.GetUpdateType(params) == "plan"
}

// ConvertError converts an error to an AcpError if it's not already one
func ConvertError(err error) *AcpError {
	if err == nil {
		return nil
	}
	if acpErr, ok := err.(*AcpError); ok {
		return acpErr
	}
	return &AcpError{
		Type:    ErrorUnknown,
		Code:    -1,
		Message: err.Error(),
	}
}

// NewConnectionError creates a connection error
func NewConnectionError(msg string, code int) *AcpError {
	return &AcpError{
		Type:    ErrorConnection,
		Code:    code,
		Message: msg,
	}
}

// NewSessionError creates a session error
func NewSessionError(msg string, code int) *AcpError {
	return &AcpError{
		Type:    ErrorSession,
		Code:    code,
		Message: msg,
	}
}

// NewNetworkError creates a network error
func NewNetworkError(msg string, code int) *AcpError {
	return &AcpError{
		Type:    ErrorNetwork,
		Code:    code,
		Message: msg,
	}
}

// NewPermissionError creates a permission error
func NewPermissionError(msg string, code int) *AcpError {
	return &AcpError{
		Type:    ErrorPermission,
		Code:    code,
		Message: msg,
	}
}

// GetBackendFromString converts a string to AcpBackend
func GetBackendFromString(backendStr string) (AcpBackend, error) {
	backendStr = strings.ToLower(strings.TrimSpace(backendStr))
	switch backendStr {
	case "claude":
		return AcpBackendClaude, nil
	case "gemini":
		return AcpBackendGemini, nil
	case "qwen":
		return AcpBackendQwen, nil
	case "codex":
		return AcpBackendCodex, nil
	case "opencode":
		return AcpBackendOpenCode, nil
	case "custom":
		return AcpBackendCustom, nil
	default:
		return "", fmt.Errorf("invalid backend: %s", backendStr)
	}
}

// IsBackendAvailable checks if a backend string is a valid backend
func IsBackendAvailable(backendStr string) bool {
	_, err := GetBackendFromString(backendStr)
	return err == nil
}
