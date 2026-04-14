// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package pi implements a UseChatBackend that spawns the pi coding agent
// as a subprocess and communicates with it via JSONL RPC mode.
// The pi agent handles LLM interaction and tool execution internally;
// this backend translates pi's RPC protocol events into waveterm SSE events.
package pi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sync"
)

// RPC event types emitted by pi on stdout during agent operation.
// These are documented in packages/coding-agent/docs/rpc.md.
type RPCEventType string

const (
	RPCEventAgentStart              RPCEventType = "agent_start"
	RPCEventAgentEnd                RPCEventType = "agent_end"
	RPCEventTurnStart              RPCEventType = "turn_start"
	RPCEventTurnEnd                RPCEventType = "turn_end"
	RPCEventMessageStart           RPCEventType = "message_start"
	RPCEventMessageEnd             RPCEventType = "message_end"
	RPCEventMessageUpdate          RPCEventType = "message_update"
	RPCEventToolExecutionStart     RPCEventType = "tool_execution_start"
	RPCEventToolExecutionUpdate    RPCEventType = "tool_execution_update"
	RPCEventToolExecutionEnd       RPCEventType = "tool_execution_end"
	RPCEventQueueUpdate            RPCEventType = "queue_update"
	RPCEventCompactionStart        RPCEventType = "compaction_start"
	RPCEventCompactionEnd          RPCEventType = "compaction_end"
	RPCEventAutoRetryStart         RPCEventType = "auto_retry_start"
	RPCEventAutoRetryEnd           RPCEventType = "auto_retry_end"
	RPCEventExtensionError         RPCEventType = "extension_error"
	RPCEventExtensionUIRequest    RPCEventType = "extension_ui_request"
)

// RPC command types sent to pi on stdin.
type RPCCommandType string

const (
	RPCmdPrompt       RPCCommandType = "prompt"
	RPCmdSteer        RPCCommandType = "steer"
	RPCmdFollowUp     RPCCommandType = "follow_up"
	RPCmdAbort        RPCCommandType = "abort"
	RPCmdNewSession   RPCCommandType = "new_session"
	RPCmdGetState     RPCCommandType = "get_state"
	RPCmdGetMessages  RPCCommandType = "get_messages"
	RPCmdSetModel     RPCCommandType = "set_model"
	RPCmdCycleModel   RPCCommandType = "cycle_model"
	RPCmdSetThinking  RPCCommandType = "set_thinking_level"
	RPCmdCompact      RPCCommandType = "compact"
	RPCmdGetStats     RPCCommandType = "get_session_stats"
	RPCmdSetSessionName RPCCommandType = "set_session_name"
	RPCmdFork         RPCCommandType = "fork"
	RPCmdExtUIRsp     RPCCommandType = "extension_ui_response"
)

// RPCCommand is a command sent to pi over stdin.
type RPCCommand struct {
	ID               string            `json:"id,omitempty"`
	Type             RPCCommandType    `json:"type"`
	Message          string            `json:"message,omitempty"`
	Images           []RPCImage       `json:"images,omitempty"`
	StreamingBehavior string           `json:"streamingBehavior,omitempty"` // "steer" | "followUp"
	Provider         string            `json:"provider,omitempty"`
	ModelID          string            `json:"modelId,omitempty"`
	Level            string            `json:"level,omitempty"`
	CustomInstr      string            `json:"customInstructions,omitempty"`
	Name             string            `json:"name,omitempty"`
	SessionPath      string            `json:"sessionPath,omitempty"`
	ParentSession    string            `json:"parentSession,omitempty"`
	OutputPath       string            `json:"outputPath,omitempty"`
	EntryID          string            `json:"entryId,omitempty"`
	Enabled          *bool             `json:"enabled,omitempty"`
	Command          string            `json:"command,omitempty"`
	// extension_ui_response fields
	ExtUIValue         string `json:"value,omitempty"`
	ExtUIConfirmed     *bool  `json:"confirmed,omitempty"`
	ExtUICancelled     bool   `json:"cancelled,omitempty"`
}

// RPCImage is an image attachment in a prompt command.
type RPCImage struct {
	Type    string `json:"type"` // always "image"
	Data    string `json:"data"` // base64-encoded
	MimeType string `json:"mimeType"`
}

// RPCResponse is a response received from pi for a command.
type RPCResponse struct {
	ID       string          `json:"id,omitempty"`
	Type     string          `json:"type"` // always "response"
	Command  string          `json:"command"`
	Success  bool            `json:"success"`
	Data     json.RawMessage `json:"data,omitempty"`
	Error    string          `json:"error,omitempty"`
}

// RPCEvent is an event streamed by pi on stdout.
// It is tagged with "type" so we decode it generically first,
// then dispatch based on the type field.
type RPCEvent map[string]any

func (e RPCEvent) EventType() RPCEventType {
	if t, ok := e["type"].(string); ok {
		return RPCEventType(t)
	}
	return ""
}

func (e RPCEvent) GetString(field string) string {
	if v, ok := e[field].(string); ok {
		return v
	}
	return ""
}

func (e RPCEvent) GetFloat(field string) float64 {
	if v, ok := e[field].(float64); ok {
		return v
	}
	return 0
}

func (e RPCEvent) GetInt(field string) int {
	if v, ok := e[field].(float64); ok {
		return int(v)
	}
	return 0
}

func (e RPCEvent) GetBool(field string) bool {
	if v, ok := e[field].(bool); ok {
		return v
	}
	return false
}

func (e RPCEvent) GetMap(field string) map[string]any {
	if v, ok := e[field].(map[string]any); ok {
		return v
	}
	return nil
}

func (e RPCEvent) GetSlice(field string) []any {
	if v, ok := e[field].([]any); ok {
		return v
	}
	return nil
}

func (e RPCEvent) GetAny(field string) any {
	return e[field]
}

// JSONLScanner reads LF-delimited JSON records from an io.Reader.
// It correctly handles JSONL framing: only splits on '\n', not on
// Unicode separators that might appear inside JSON strings.
// This is critical: Node's readline is NOT protocol-compliant because
// it splits on U+2028 and U+2029 which are valid inside JSON strings.
type JSONLScanner struct {
	reader *io.LimitedReader
	buf    bytes.Buffer
	scanR  *bufio.Reader
	once   sync.Once
}

func NewJSONLScanner(r io.Reader) *JSONLScanner {
	// Use a large limit; we reset it via SetLimit after each record
	lr := io.LimitedReader{R: r, N: 1 << 20} // 1MB per record max
	return &JSONLScanner{
		scanR: bufio.NewReader(&lr),
	}
}

// Next reads the next JSONL record and returns it as json.RawMessage.
// Returns nil, nil when EOF is reached.
// Returns an error on parse failure.
func (s *JSONLScanner) Next() (json.RawMessage, error) {
	s.once.Do(func() {}) // no-op to satisfy linter

	for {
		l, prefix, err := s.scanR.ReadLine()
		if err != nil {
			if err == io.EOF {
				// Return buffered content if any (final record without trailing newline)
				if s.buf.Len() > 0 {
					rec := make([]byte, s.buf.Len())
					copy(rec, s.buf.Bytes())
					s.buf.Reset()
					return rec, nil
				}
				return nil, nil
			}
			return nil, fmt.Errorf("JSONL read error: %w", err)
		}

		// Strip optional trailing CR (for \r\n line endings)
		if len(l) > 0 && l[len(l)-1] == '\r' {
			l = l[:len(l)-1]
		}

		if prefix {
			// Line was too long; accumulate
			s.buf.Write(l)
			s.buf.WriteByte('\n')
		} else {
			s.buf.Write(l)
			break
		}
	}

	if s.buf.Len() == 0 {
		// Empty line (blank newline) — skip
		return s.Next()
	}

	rec := make([]byte, s.buf.Len())
	copy(rec, s.buf.Bytes())
	s.buf.Reset()
	return rec, nil
}

// RPCEventDecoder decodes pi RPC events from json.RawMessage.
type RPCEventDecoder struct{}

func (RPCEventDecoder) Decode(raw json.RawMessage) (RPCEvent, error) {
	var ev RPCEvent
	if err := json.Unmarshal(raw, &ev); err != nil {
		return nil, fmt.Errorf("failed to unmarshal RPC event: %w", err)
	}
	return ev, nil
}
