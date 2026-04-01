// Package protocol implements ACP (Agent Control Protocol) message encoding/decoding
//
// This file handles JSON-RPC 2.0 message encoding and decoding for ACP communication.
package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const (
	jsonrpcVersion = "2.0"
)

// EncodeRequest encodes an ACP request into JSON-RPC 2.0 format
func EncodeRequest(id int, method string, params map[string]interface{}) ([]byte, error) {
	req := AcpRequest{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	return data, nil
}

// EncodeNotification encodes an ACP notification into JSON-RPC 2.0 format
func EncodeNotification(method string, params map[string]interface{}) ([]byte, error) {
	notif := AcpNotification{
		JSONRPC: jsonrpcVersion,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(notif)
	if err != nil {
		return nil, fmt.Errorf("failed to encode notification: %w", err)
	}

	return data, nil
}

// DecodeResponse decodes a JSON-RPC 2.0 response
func DecodeResponse(data []byte) (*AcpResponse, error) {
	var resp AcpResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Validate JSON-RPC version
	if resp.JSONRPC != jsonrpcVersion {
		return nil, &AcpError{
			Type:    ErrorUnknown,
			Message: fmt.Sprintf("unsupported JSON-RPC version: %s", resp.JSONRPC),
		}
	}

	return &resp, nil
}

// DecodeNotification decodes a JSON-RPC 2.0 notification
func DecodeNotification(data []byte) (*AcpNotification, error) {
	var notif AcpNotification
	if err := json.Unmarshal(data, &notif); err != nil {
		return nil, fmt.Errorf("failed to decode notification: %w", err)
	}

	// Validate JSON-RPC version
	if notif.JSONRPC != jsonrpcVersion {
		return nil, &AcpError{
			Type:    ErrorUnknown,
			Message: fmt.Sprintf("unsupported JSON-RPC version: %s", notif.JSONRPC),
		}
	}

	return &notif, nil
}

// DecodeMessage decodes any JSON-RPC message (response or notification)
func DecodeMessage(data []byte) (interface{}, error) {
	// Check if it has an "id" field to determine if it's a response or notification
	var raw struct {
		ID int `json:"id,omitempty"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("failed to determine message type: %w", err)
	}

	if raw.ID == 0 {
		return DecodeNotification(data)
	}
	return DecodeResponse(data)
}

// EncodeSessionNewRequest encodes a session/new request
func EncodeSessionNewRequest(id int, config AcpSessionConfig) ([]byte, error) {
	params := map[string]interface{}{
		"cwd": config.Cwd,
	}
	if config.ResumeSession {
		params["resumeSession"] = config.SessionID
	}
	if config.ForkSession {
		params["forkSession"] = config.SessionID
	}
	if config.YoloMode {
		params[config.getSessionModeKey()] = true
	}
	if config.Model != "" {
		params["model"] = config.Model
	}
	for k, v := range config.Env {
		params[k] = v
	}

	return EncodeRequest(id, "session/new", params)
}

// getSessionModeKey returns the session mode key for the current backend
func (c *AcpSessionConfig) getSessionModeKey() string {
	switch c.Backend {
	case AcpBackendClaude, AcpBackendCodex:
		return ClaudeYoloSessionMode
	case AcpBackendQwen:
		return QwenYoloSessionMode
	default:
		return ClaudeYoloSessionMode
	}
}

// EncodeSessionLoadRequest encodes a session/load request
func EncodeSessionLoadRequest(id int, sessionID string) ([]byte, error) {
	params := map[string]interface{}{
		"sessionId": sessionID,
	}
	return EncodeRequest(id, "session/load", params)
}

// EncodePromptStreamRequest encodes a prompt/stream request
func EncodePromptStreamRequest(id int, sessionID string, prompt string, opts AcpPromptOptions) ([]byte, error) {
	params := map[string]interface{}{
		"sessionId": sessionID,
		"prompt":    prompt,
	}
	if len(opts.Files) > 0 {
		params["files"] = opts.Files
	}
	if opts.ModelOverride != "" {
		params["model"] = opts.ModelOverride
	}
	return EncodeRequest(id, "prompt/stream", params)
}

// EncodePermissionConfirmRequest encodes a permission/confirm request
func EncodePermissionConfirmRequest(id int, callID string, optionID string) ([]byte, error) {
	params := map[string]interface{}{
		"callId":   callID,
		"optionId": optionID,
	}
	return EncodeRequest(id, "permission/confirm", params)
}

// SessionNewResult represents the result of a session/new request
type SessionNewResult struct {
	SessionID string              `json:"sessionId"`
	Models    *AcpSessionModels   `json:"models,omitempty"`
	Options   []AcpSessionConfigOption `json:"options,omitempty"`
}

// SessionLoadResult represents the result of a session/load request
type SessionLoadResult struct {
	SessionID string `json:"sessionId"`
	Updated   bool   `json:"updated"`
}

// MessageSplitter is a reader that splits JSON-RPC messages from a stream
// ACP messages may be separated by newlines or concatenated directly
type MessageSplitter struct {
	buf *bytes.Buffer
}

// NewMessageSplitter creates a new message splitter
func NewMessageSplitter() *MessageSplitter {
	return &MessageSplitter{
		buf: &bytes.Buffer{},
	}
}

// ReadMessage reads and returns the next complete JSON-RPC message from the stream
func (ms *MessageSplitter) ReadMessage(r io.Reader) ([]byte, error) {
	decoder := json.NewDecoder(r)

	// Try to read a JSON object - decoder handles concatenated JSON objects
	var msg json.RawMessage
	if err := decoder.Decode(&msg); err != nil {
		if err == io.EOF {
			return nil, io.EOF
		}
		return nil, fmt.Errorf("failed to read JSON message: %w", err)
	}

	return msg, nil
}

// StreamMessage iterates over messages from a reader
// Messages can be separated by whitespace or concatenated
func StreamMessage(r io.Reader, callback func([]byte) error) error {
	decoder := json.NewDecoder(r)

	for {
		// Skip any whitespace between messages
		if err := skipWhitespace(decoder); err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		var msg json.RawMessage
		if err := decoder.Decode(&msg); err != nil {
			if err == io.EOF {
				return nil
			}
			return &AcpError{
				Type:    ErrorConnection,
				Message: fmt.Sprintf("stream message decode error: %v", err),
			}
		}

		if err := callback(msg); err != nil {
			return err
		}
	}
}

// skipWhitespace is a placeholder - json.Decoder handles whitespace automatically
// Kept for API compatibility, does nothing
func skipWhitespace(decoder *json.Decoder) error {
	return nil
}

// LinesToMessages converts raw lines from stdout to JSON messages
// Some ACP implementations use newline-delimited JSON
func LinesToMessages(lines []string) [][]byte {
	var messages [][]byte
	var current strings.Builder

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Try to parse as JSON on its own
		if json.Valid([]byte(line)) {
			// If we have accumulated content, flush it first
			if current.Len() > 0 {
				current.WriteString(line)
				if json.Valid([]byte(current.String())) {
					messages = append(messages, []byte(current.String()))
					current.Reset()
				}
			} else {
				messages = append(messages, []byte(line))
			}
		} else {
			// Accumulate partial JSON
			current.WriteString(line)
		}
	}

	// Flush remaining content
	if current.Len() > 0 && json.Valid([]byte(current.String())) {
		messages = append(messages, []byte(current.String()))
	}

	return messages
}
