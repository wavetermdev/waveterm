// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTailLines(t *testing.T) {
	tests := []struct {
		name     string
		lines    []string
		tail     int
		expected []string
	}{
		{
			name:     "exact tail",
			lines:    []string{"1", "2", "3", "4", "5"},
			tail:     3,
			expected: []string{"3", "4", "5"},
		},
		{
			name:     "tail larger than buffer returns all",
			lines:    []string{"1", "2", "3"},
			tail:     50,
			expected: []string{"1", "2", "3"},
		},
		{
			name:     "tail equal to buffer size returns all",
			lines:    []string{"1", "2", "3"},
			tail:     3,
			expected: []string{"1", "2", "3"},
		},
		{
			name:     "tail one returns last line",
			lines:    []string{"a", "b", "c"},
			tail:     1,
			expected: []string{"c"},
		},
		{
			name:     "tail zero returns all",
			lines:    []string{"a", "b", "c"},
			tail:     0,
			expected: []string{"a", "b", "c"},
		},
		{
			name:     "empty buffer",
			lines:    []string{},
			tail:     5,
			expected: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tailLines(tt.lines, tt.tail)
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("tailLines(%v, %d) = %v, want %v", tt.lines, tt.tail, got, tt.expected)
			}
		})
	}
}

func TestBlockCaptureJSONShape(t *testing.T) {
	out := blockCaptureJSONOutput{
		Lines:       []string{"line 1", "line 2"},
		TotalLines:  42,
		LastUpdated: 1690000000000,
		LineStart:   10,
	}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	if _, ok := decoded["lines"]; !ok {
		t.Errorf("JSON missing key %q: %s", "lines", string(bytes))
	}
	if _, ok := decoded["totallines"]; !ok {
		t.Errorf("JSON missing key %q: %s", "totallines", string(bytes))
	}
	if _, ok := decoded["lastupdated"]; !ok {
		t.Errorf("JSON missing key %q: %s", "lastupdated", string(bytes))
	}
	if _, ok := decoded["linestart"]; !ok {
		t.Errorf("JSON missing key %q: %s", "linestart", string(bytes))
	}
	if _, ok := decoded["truncated"]; ok {
		t.Errorf("JSON should omit truncated when false: %s", string(bytes))
	}
	if totallines, ok := decoded["totallines"].(float64); !ok || int(totallines) != 42 {
		t.Errorf("totallines = %v, want 42", decoded["totallines"])
	}
	if lastupdated, ok := decoded["lastupdated"].(float64); !ok || int64(lastupdated) != 1690000000000 {
		t.Errorf("lastupdated = %v, want 1690000000000", decoded["lastupdated"])
	}
	if linestart, ok := decoded["linestart"].(float64); !ok || int(linestart) != 10 {
		t.Errorf("linestart = %v, want 10", decoded["linestart"])
	}
	lines, ok := decoded["lines"].([]interface{})
	if !ok || len(lines) != 2 || lines[0] != "line 1" || lines[1] != "line 2" {
		t.Errorf("lines = %v, want [\"line 1\" \"line 2\"]", decoded["lines"])
	}
}

func TestBlockCaptureJSONTruncated(t *testing.T) {
	out := blockCaptureJSONOutput{
		Lines:       []string{"ab"},
		TotalLines:  2,
		LastUpdated: 1,
		LineStart:   0,
		Truncated:   true,
	}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}
	truncated, ok := decoded["truncated"].(bool)
	if !ok || !truncated {
		t.Errorf("truncated = %v, want true", decoded["truncated"])
	}
}

func TestValidateCaptureFlags(t *testing.T) {
	tests := []struct {
		name    string
		flags   captureFlags
		wantErr bool
	}{
		{
			name:    "no flags is valid",
			wantErr: false,
		},
		{
			name:    "start only is valid",
			flags:   captureFlags{StartSet: true, Start: 1},
			wantErr: false,
		},
		{
			name:    "end only is valid",
			flags:   captureFlags{EndSet: true, End: 10},
			wantErr: false,
		},
		{
			name:    "start and end is valid",
			flags:   captureFlags{StartSet: true, EndSet: true, Start: 1, End: 10},
			wantErr: false,
		},
		{
			name:    "tail alone is valid",
			flags:   captureFlags{TailSet: true, Tail: 10},
			wantErr: false,
		},
		{
			name:    "all alone is valid",
			flags:   captureFlags{AllSet: true},
			wantErr: false,
		},
		{
			name:    "since-line alone is valid",
			flags:   captureFlags{SinceLineSet: true, SinceLine: 5},
			wantErr: false,
		},
		{
			name:    "since-line with end is valid",
			flags:   captureFlags{SinceLineSet: true, EndSet: true, SinceLine: 5, End: 20},
			wantErr: false,
		},
		{
			name:    "max-bytes positive is valid",
			flags:   captureFlags{MaxBytesSet: true, MaxBytes: 1024},
			wantErr: false,
		},
		{
			name:    "tail with start is invalid",
			flags:   captureFlags{TailSet: true, StartSet: true, Tail: 10},
			wantErr: true,
		},
		{
			name:    "tail with end is invalid",
			flags:   captureFlags{TailSet: true, EndSet: true, Tail: 10},
			wantErr: true,
		},
		{
			name:    "tail with start and end is invalid",
			flags:   captureFlags{TailSet: true, StartSet: true, EndSet: true, Tail: 10},
			wantErr: true,
		},
		{
			name:    "tail with all is invalid",
			flags:   captureFlags{TailSet: true, AllSet: true, Tail: 10},
			wantErr: true,
		},
		{
			name:    "tail with since-line is invalid",
			flags:   captureFlags{TailSet: true, SinceLineSet: true, Tail: 10, SinceLine: 5},
			wantErr: true,
		},
		{
			name:    "all with start is invalid",
			flags:   captureFlags{AllSet: true, StartSet: true},
			wantErr: true,
		},
		{
			name:    "all with end is invalid",
			flags:   captureFlags{AllSet: true, EndSet: true},
			wantErr: true,
		},
		{
			name:    "all with since-line is invalid",
			flags:   captureFlags{AllSet: true, SinceLineSet: true, SinceLine: 5},
			wantErr: true,
		},
		{
			name:    "since-line with start is invalid",
			flags:   captureFlags{SinceLineSet: true, StartSet: true, SinceLine: 5, Start: 1},
			wantErr: true,
		},
		{
			name:    "tail zero is invalid",
			flags:   captureFlags{TailSet: true, Tail: 0},
			wantErr: true,
		},
		{
			name:    "tail negative is invalid",
			flags:   captureFlags{TailSet: true, Tail: -5},
			wantErr: true,
		},
		{
			name:    "since-line negative is invalid",
			flags:   captureFlags{SinceLineSet: true, SinceLine: -1},
			wantErr: true,
		},
		{
			name:    "max-bytes zero is invalid when set",
			flags:   captureFlags{MaxBytesSet: true, MaxBytes: 0},
			wantErr: true,
		},
		{
			name:    "max-bytes negative is invalid",
			flags:   captureFlags{MaxBytesSet: true, MaxBytes: -10},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateCaptureFlags(tt.flags)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateCaptureFlags(%+v) error = %v, wantErr %v", tt.flags, err, tt.wantErr)
			}
		})
	}
}

func TestDecodeEscapes(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "plain text unchanged", input: "hello", want: "hello"},
		{name: "empty", input: "", want: ""},
		{name: "newline escape", input: "a\\nb", want: "a\nb"},
		{name: "tab escape", input: "a\\tb", want: "a\tb"},
		{name: "carriage return escape", input: "a\\rb", want: "a\rb"},
		{name: "literal backslash", input: "a\\\\b", want: "a\\b"},
		{name: "unicode ascii", input: "\\u0041", want: "A"},
		{name: "unicode e-acute", input: "\\u00e9", want: "é"},
		{name: "unicode escape sequence", input: "\\u001b[A", want: "\x1b[A"},
		{name: "mixed escapes", input: "x\\u0041\\ny", want: "xA\ny"},
		{name: "invalid escape letter", input: "a\\qb", wantErr: true},
		{name: "trailing backslash", input: "a\\", wantErr: true},
		{name: "unicode too few digits", input: "\\u12", wantErr: true},
		{name: "unicode non-hex", input: "\\u12G4", wantErr: true},
		{name: "unicode trailing backslash", input: "\\u", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeEscapes(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("decodeEscapes(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if got != tt.want {
				t.Errorf("decodeEscapes(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidateSendKeysInput(t *testing.T) {
	tests := []struct {
		name    string
		textSet bool
		secret  string
		wantErr bool
	}{
		{name: "text only is valid", textSet: true, secret: ""},
		{name: "secret only is valid", textSet: false, secret: "api-key"},
		{name: "neither is valid", textSet: false, secret: ""},
		{name: "text and secret is invalid", textSet: true, secret: "api-key", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSendKeysInput(tt.textSet, tt.secret)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateSendKeysInput(%v, %q) error = %v, wantErr %v", tt.textSet, tt.secret, err, tt.wantErr)
			}
		})
	}
}

func TestMapProcessState(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "done maps to exited", input: "done", want: "exited"},
		{name: "running maps to running", input: "running", want: "running"},
		{name: "init maps to running", input: "init", want: "running"},
		{name: "empty maps to running", input: "", want: "running"},
		{name: "unknown maps to running", input: "bogus", want: "running"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapProcessState(tt.input)
			if got != tt.want {
				t.Errorf("mapProcessState(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestLookupConnStatus(t *testing.T) {
	tests := []struct {
		name       string
		connStatus []wshrpc.ConnStatus
		connection string
		want       string
	}{
		{name: "empty connection is connected", connection: "", want: "connected"},
		{name: "local is connected", connection: "local", want: "connected"},
		{name: "local prefix is connected", connection: "local:dev", want: "connected"},
		{name: "wsl is connected", connection: "wsl://Ubuntu", want: "connected"},
		{
			name: "remote connected",
			connStatus: []wshrpc.ConnStatus{
				{Connection: "prod-server", Connected: true, Status: "connected"},
			},
			connection: "prod-server",
			want:       "connected",
		},
		{
			name: "remote not connected uses status",
			connStatus: []wshrpc.ConnStatus{
				{Connection: "prod-server", Connected: false, Status: "reconnecting"},
			},
			connection: "prod-server",
			want:       "reconnecting",
		},
		{
			name: "remote not connected empty status",
			connStatus: []wshrpc.ConnStatus{
				{Connection: "prod-server", Connected: false},
			},
			connection: "prod-server",
			want:       "disconnected",
		},
		{
			name: "remote not found",
			connStatus: []wshrpc.ConnStatus{
				{Connection: "other", Connected: true, Status: "connected"},
			},
			connection: "prod-server",
			want:       "disconnected",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := lookupConnStatus(tt.connStatus, tt.connection)
			if got != tt.want {
				t.Errorf("lookupConnStatus(%v, %q) = %q, want %q", tt.connStatus, tt.connection, got, tt.want)
			}
		})
	}
}

func TestAssembleInputBytes(t *testing.T) {
	tests := []struct {
		name    string
		text    string
		enter   bool
		escapes bool
		want    string
		wantErr bool
	}{
		{name: "plain text no enter", text: "echo hi", want: "echo hi"},
		{name: "enter appends carriage return", text: "echo hi", enter: true, want: "echo hi\r"},
		{name: "enter only", enter: true, want: "\r"},
		{name: "escapes decodes newline", text: "a\\nb", escapes: true, want: "a\nb"},
		{name: "escapes off leaves literal", text: "a\\nb", escapes: false, want: "a\\nb"},
		{name: "escapes and enter", text: "a\\n", enter: true, escapes: true, want: "a\n\r"},
		{name: "invalid escape errors", text: "a\\qb", escapes: true, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := assembleInputBytes(tt.text, tt.enter, tt.escapes)
			if (err != nil) != tt.wantErr {
				t.Errorf("assembleInputBytes(%q, %v, %v) error = %v, wantErr %v", tt.text, tt.enter, tt.escapes, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if string(got) != tt.want {
				t.Errorf("assembleInputBytes(%q, %v, %v) = %q, want %q", tt.text, tt.enter, tt.escapes, string(got), tt.want)
			}
		})
	}
}

func TestBlockStatusJSONShape(t *testing.T) {
	out := blockStatusJSONOutput{
		ProcessState: "exited",
		ExitCode:     0,
		Connection:   "prod-server",
		ConnStatus:   "connected",
	}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}

	for _, key := range []string{"processstate", "exitcode", "connection", "connstatus"} {
		if _, ok := decoded[key]; !ok {
			t.Errorf("JSON missing key %q: %s", key, string(bytes))
		}
	}
	if ps, ok := decoded["processstate"].(string); !ok || ps != "exited" {
		t.Errorf("processstate = %v, want %q", decoded["processstate"], "exited")
	}
	if ec, ok := decoded["exitcode"].(float64); !ok || int(ec) != 0 {
		t.Errorf("exitcode = %v, want 0", decoded["exitcode"])
	}
	if conn, ok := decoded["connection"].(string); !ok || conn != "prod-server" {
		t.Errorf("connection = %v, want %q", decoded["connection"], "prod-server")
	}
	if cs, ok := decoded["connstatus"].(string); !ok || cs != "connected" {
		t.Errorf("connstatus = %v, want %q", decoded["connstatus"], "connected")
	}
}

func TestDirectionToTargetAction(t *testing.T) {
	tests := []struct {
		name      string
		direction string
		want      string
		wantErr   bool
	}{
		{name: "left", direction: "left", want: "splitleft"},
		{name: "right", direction: "right", want: "splitright"},
		{name: "above", direction: "above", want: "splitup"},
		{name: "below", direction: "below", want: "splitdown"},
		{name: "empty", direction: "", wantErr: true},
		{name: "uppercase", direction: "LEFT", wantErr: true},
		{name: "unknown", direction: "sideways", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := directionToTargetAction(tt.direction)
			if (err != nil) != tt.wantErr {
				t.Errorf("directionToTargetAction(%q) error = %v, wantErr %v", tt.direction, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if got != tt.want {
				t.Errorf("directionToTargetAction(%q) = %q, want %q", tt.direction, got, tt.want)
			}
		})
	}
}

func TestValidateSelectAddressing(t *testing.T) {
	tests := []struct {
		name          string
		leftOf        string
		rightOf       string
		aboveOf       string
		belowOf       string
		positional    string
		wantDirection string
		wantBaseRef   string
		wantErr       bool
	}{
		{name: "no addressing form is valid (defaults to this)"},
		{name: "positional only", positional: "block:abc"},
		{name: "left-of only", leftOf: "block:abc", wantDirection: "left", wantBaseRef: "block:abc"},
		{name: "right-of only", rightOf: "block:abc", wantDirection: "right", wantBaseRef: "block:abc"},
		{name: "above only", aboveOf: "block:abc", wantDirection: "above", wantBaseRef: "block:abc"},
		{name: "below only", belowOf: "block:abc", wantDirection: "below", wantBaseRef: "block:abc"},
		{name: "right-of and left-of conflict", rightOf: "b1", leftOf: "b2", wantErr: true},
		{name: "right-of and above conflict", rightOf: "b1", aboveOf: "b2", wantErr: true},
		{name: "right-of and positional conflict", rightOf: "b1", positional: "b2", wantErr: true},
		{name: "left-of and positional conflict", leftOf: "b1", positional: "b2", wantErr: true},
		{name: "all four conflict", leftOf: "a", rightOf: "b", aboveOf: "c", belowOf: "d", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotDir, gotRef, err := validateSelectAddressing(tt.leftOf, tt.rightOf, tt.aboveOf, tt.belowOf, tt.positional)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateSelectAddressing(%q,%q,%q,%q,%q) error = %v, wantErr %v",
					tt.leftOf, tt.rightOf, tt.aboveOf, tt.belowOf, tt.positional, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if gotDir != tt.wantDirection || gotRef != tt.wantBaseRef {
				t.Errorf("validateSelectAddressing(...) = (%q, %q), want (%q, %q)", gotDir, gotRef, tt.wantDirection, tt.wantBaseRef)
			}
		})
	}
}

func TestValidateSplitPair(t *testing.T) {
	tests := []struct {
		name       string
		split      string
		relativeTo string
		wantErr    bool
	}{
		{name: "neither set", split: "", relativeTo: "", wantErr: false},
		{name: "both set", split: "right", relativeTo: "block:abc", wantErr: false},
		{name: "split without relative-to", split: "right", relativeTo: "", wantErr: true},
		{name: "relative-to without split", split: "", relativeTo: "block:abc", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSplitPair(tt.split, tt.relativeTo)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateSplitPair(%q, %q) error = %v, wantErr %v", tt.split, tt.relativeTo, err, tt.wantErr)
			}
		})
	}
}

func TestValidateRenameArgs(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		wantRef  string
		wantName string
		wantErr  bool
	}{
		{name: "valid", args: []string{"block:abc", "fixer-agent"}, wantRef: "block:abc", wantName: "fixer-agent"},
		{name: "zero args", args: nil, wantErr: true},
		{name: "one arg", args: []string{"block:abc"}, wantErr: true},
		{name: "three args", args: []string{"block:abc", "name", "extra"}, wantErr: true},
		{name: "empty name", args: []string{"block:abc", ""}, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotRef, gotName, err := validateRenameArgs(tt.args)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateRenameArgs(%v) error = %v, wantErr %v", tt.args, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if gotRef != tt.wantRef || gotName != tt.wantName {
				t.Errorf("validateRenameArgs(%v) = (%q, %q), want (%q, %q)", tt.args, gotRef, gotName, tt.wantRef, tt.wantName)
			}
		})
	}
}

func TestBuildBlockNewMeta(t *testing.T) {
	t.Run("plain terminal block", func(t *testing.T) {
		meta := buildBlockNewMeta("term", "", "/home/user", "prod")
		if meta[waveobj.MetaKey_View] != "term" {
			t.Errorf("view = %v, want %q", meta[waveobj.MetaKey_View], "term")
		}
		if meta[waveobj.MetaKey_Controller] != "shell" {
			t.Errorf("controller = %v, want %q", meta[waveobj.MetaKey_Controller], "shell")
		}
		if meta[waveobj.MetaKey_CmdCwd] != "/home/user" {
			t.Errorf("cmd:cwd = %v, want %q", meta[waveobj.MetaKey_CmdCwd], "/home/user")
		}
		if meta[waveobj.MetaKey_Connection] != "prod" {
			t.Errorf("connection = %v, want %q", meta[waveobj.MetaKey_Connection], "prod")
		}
		for _, key := range []string{waveobj.MetaKey_Cmd, waveobj.MetaKey_CmdRunOnStart, waveobj.MetaKey_CmdRunOnce, waveobj.MetaKey_CmdCloseOnExit} {
			if _, ok := meta[key]; ok {
				t.Errorf("plain term block should not have key %q", key)
			}
		}
	})

	t.Run("command block is persistent", func(t *testing.T) {
		meta := buildBlockNewMeta("term", "tail -f /var/log/syslog", "/home/user", "prod")
		if meta[waveobj.MetaKey_View] != "term" {
			t.Errorf("view = %v, want %q", meta[waveobj.MetaKey_View], "term")
		}
		if meta[waveobj.MetaKey_Controller] != "cmd" {
			t.Errorf("controller = %v, want %q", meta[waveobj.MetaKey_Controller], "cmd")
		}
		if meta[waveobj.MetaKey_Cmd] != "tail -f /var/log/syslog" {
			t.Errorf("cmd = %v, want %q", meta[waveobj.MetaKey_Cmd], "tail -f /var/log/syslog")
		}
		if meta[waveobj.MetaKey_CmdRunOnStart] != true {
			t.Errorf("cmd:runonstart = %v, want true", meta[waveobj.MetaKey_CmdRunOnStart])
		}
		if meta[waveobj.MetaKey_CmdShell] != true {
			t.Errorf("cmd:shell = %v, want true", meta[waveobj.MetaKey_CmdShell])
		}
		if meta[waveobj.MetaKey_CmdClearOnStart] != true {
			t.Errorf("cmd:clearonstart = %v, want true", meta[waveobj.MetaKey_CmdClearOnStart])
		}
		args, ok := meta[waveobj.MetaKey_CmdArgs].([]string)
		if !ok || len(args) != 0 {
			t.Errorf("cmd:args = %v (%T), want empty []string", meta[waveobj.MetaKey_CmdArgs], meta[waveobj.MetaKey_CmdArgs])
		}
		// Persistent: the block stays open after the command exits.
		for _, key := range []string{waveobj.MetaKey_CmdRunOnce, waveobj.MetaKey_CmdCloseOnExit, waveobj.MetaKey_CmdCloseOnExitForce} {
			if _, ok := meta[key]; ok {
				t.Errorf("persistent command block should not have key %q", key)
			}
		}
	})

	t.Run("non-term view without cmd", func(t *testing.T) {
		meta := buildBlockNewMeta("web", "", "/home/user", "")
		if meta[waveobj.MetaKey_View] != "web" {
			t.Errorf("view = %v, want %q", meta[waveobj.MetaKey_View], "web")
		}
		if _, ok := meta[waveobj.MetaKey_Controller]; ok {
			t.Errorf("non-term view should not have controller, got %v", meta[waveobj.MetaKey_Controller])
		}
		if _, ok := meta[waveobj.MetaKey_Connection]; ok {
			t.Errorf("non-term view with empty connection should not have connection key")
		}
	})
}

func TestBuildEnvContent(t *testing.T) {
	content := buildEnvContent([]string{"A=1", "B=hello world", "NOVALUE"})
	for _, want := range []string{"A=1\x00", "B=hello world\x00"} {
		if !strings.Contains(content, want) {
			t.Errorf("buildEnvContent() = %q, want it to contain %q", content, want)
		}
	}
	if strings.Contains(content, "NOVALUE") {
		t.Errorf("buildEnvContent() = %q, should not include malformed env var without '='", content)
	}
}

func TestBlockNewJSONShape(t *testing.T) {
	out := blockNewJSONOutput{BlockId: "1234"}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}
	if id, ok := decoded["blockid"].(string); !ok || id != "1234" {
		t.Errorf("blockid = %v, want %q", decoded["blockid"], "1234")
	}
}

func TestShouldApplyDefaultTail(t *testing.T) {
	tests := []struct {
		name  string
		flags captureFlags
		want  bool
	}{
		{name: "no flags applies default", want: true},
		{name: "tail set does not apply", flags: captureFlags{TailSet: true, Tail: 10}, want: false},
		{name: "all set does not apply", flags: captureFlags{AllSet: true}, want: false},
		{name: "start set does not apply", flags: captureFlags{StartSet: true}, want: false},
		{name: "end set does not apply", flags: captureFlags{EndSet: true}, want: false},
		{name: "since-line set does not apply", flags: captureFlags{SinceLineSet: true, SinceLine: 4}, want: false},
		{name: "max-bytes alone still applies default", flags: captureFlags{MaxBytesSet: true, MaxBytes: 100}, want: true},
		{name: "last-command does not apply default tail", flags: captureFlags{LastCommandSet: true}, want: false},
		{name: "last-command with max-bytes does not apply default", flags: captureFlags{LastCommandSet: true, MaxBytesSet: true, MaxBytes: 100}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldApplyDefaultTail(tt.flags)
			if got != tt.want {
				t.Errorf("shouldApplyDefaultTail(%+v) = %v, want %v", tt.flags, got, tt.want)
			}
		})
	}
}

func TestResolveCaptureRequest(t *testing.T) {
	tests := []struct {
		name          string
		flags         captureFlags
		wantStart     int
		wantEnd       int
		wantTail      int
		wantApplyTail bool
	}{
		{
			name:          "default tail 200",
			wantStart:     0,
			wantEnd:       0,
			wantTail:      defaultCaptureTail,
			wantApplyTail: true,
		},
		{
			name:          "explicit tail",
			flags:         captureFlags{TailSet: true, Tail: 50},
			wantStart:     0,
			wantEnd:       0,
			wantTail:      50,
			wantApplyTail: true,
		},
		{
			name:      "all",
			flags:     captureFlags{AllSet: true},
			wantStart: 0,
			wantEnd:   0,
		},
		{
			name:      "start and end",
			flags:     captureFlags{StartSet: true, EndSet: true, Start: 10, End: 20},
			wantStart: 10,
			wantEnd:   20,
		},
		{
			name:      "since-line maps to LineStart",
			flags:     captureFlags{SinceLineSet: true, SinceLine: 15},
			wantStart: 15,
			wantEnd:   0,
		},
		{
			name:      "since-line with end",
			flags:     captureFlags{SinceLineSet: true, EndSet: true, SinceLine: 15, End: 40},
			wantStart: 15,
			wantEnd:   40,
		},
		{
			name:      "last-command does not tail",
			flags:     captureFlags{LastCommandSet: true},
			wantStart: 0,
			wantEnd:   0,
		},
		{
			name:          "last-command with explicit tail still tails",
			flags:         captureFlags{LastCommandSet: true, TailSet: true, Tail: 10},
			wantStart:     0,
			wantEnd:       0,
			wantTail:      10,
			wantApplyTail: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotStart, gotEnd, gotTail, gotApply := resolveCaptureRequest(tt.flags)
			if gotStart != tt.wantStart || gotEnd != tt.wantEnd || gotTail != tt.wantTail || gotApply != tt.wantApplyTail {
				t.Errorf("resolveCaptureRequest(%+v) = (%d, %d, %d, %v), want (%d, %d, %d, %v)",
					tt.flags, gotStart, gotEnd, gotTail, gotApply, tt.wantStart, tt.wantEnd, tt.wantTail, tt.wantApplyTail)
			}
		})
	}
}

func TestTruncateJoinedOutput(t *testing.T) {
	tests := []struct {
		name          string
		lines         []string
		maxBytes      int
		want          []string
		wantTruncated bool
	}{
		{
			name:     "no limit returns original",
			lines:    []string{"hello", "world"},
			maxBytes: 0,
			want:     []string{"hello", "world"},
		},
		{
			name:     "under limit unchanged",
			lines:    []string{"ab", "cd"},
			maxBytes: 100,
			want:     []string{"ab", "cd"},
		},
		{
			name:          "truncates joined output not per line",
			lines:         []string{"hello", "world"},
			maxBytes:      8,
			want:          []string{"hello", "wo"},
			wantTruncated: true,
		},
		{
			name:          "exact length not truncated",
			lines:         []string{"ab", "cd"},
			maxBytes:      5, // "ab\ncd"
			want:          []string{"ab", "cd"},
			wantTruncated: false,
		},
		{
			name:          "empty after truncate",
			lines:         []string{"hello"},
			maxBytes:      0,
			want:          []string{"hello"},
			wantTruncated: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, truncated := truncateJoinedOutput(tt.lines, tt.maxBytes)
			if truncated != tt.wantTruncated {
				t.Errorf("truncateJoinedOutput(%v, %d) truncated = %v, want %v", tt.lines, tt.maxBytes, truncated, tt.wantTruncated)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("truncateJoinedOutput(%v, %d) = %v, want %v", tt.lines, tt.maxBytes, got, tt.want)
			}
		})
	}
}

func TestApplySinceFilter(t *testing.T) {
	lines := []string{"a", "b"}
	tests := []struct {
		name        string
		lastUpdated int64
		sinceMs     int64
		sinceSet    bool
		wantEmpty   bool
	}{
		{name: "not set returns lines", lastUpdated: 100, sinceMs: 200, wantEmpty: false},
		{name: "lastupdated equal to since returns empty", lastUpdated: 100, sinceMs: 100, sinceSet: true, wantEmpty: true},
		{name: "lastupdated less than since returns empty", lastUpdated: 50, sinceMs: 100, sinceSet: true, wantEmpty: true},
		{name: "lastupdated greater than since returns lines", lastUpdated: 150, sinceMs: 100, sinceSet: true, wantEmpty: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := applySinceFilter(lines, tt.lastUpdated, tt.sinceMs, tt.sinceSet)
			if tt.wantEmpty {
				if len(got) != 0 {
					t.Errorf("applySinceFilter(...) = %v, want empty", got)
				}
				return
			}
			if !reflect.DeepEqual(got, lines) {
				t.Errorf("applySinceFilter(...) = %v, want %v", got, lines)
			}
		})
	}
}

func TestEffectiveLineStart(t *testing.T) {
	tests := []struct {
		name          string
		rpcLineStart  int
		fetchedCount  int
		returnedCount int
		want          int
	}{
		{name: "no tail", rpcLineStart: 10, fetchedCount: 5, returnedCount: 5, want: 10},
		{name: "tailed last 2 of 5 from 0", rpcLineStart: 0, fetchedCount: 5, returnedCount: 2, want: 3},
		{name: "tailed last 2 of 5 from 10", rpcLineStart: 10, fetchedCount: 5, returnedCount: 2, want: 13},
		{name: "returned more than fetched clamps skip to 0", rpcLineStart: 4, fetchedCount: 2, returnedCount: 5, want: 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := effectiveLineStart(tt.rpcLineStart, tt.fetchedCount, tt.returnedCount)
			if got != tt.want {
				t.Errorf("effectiveLineStart(%d, %d, %d) = %d, want %d",
					tt.rpcLineStart, tt.fetchedCount, tt.returnedCount, got, tt.want)
			}
		})
	}
}

func TestValidateWaitFlags(t *testing.T) {
	tests := []struct {
		name      string
		untilExit bool
		contains  string
		idleSet   bool
		idleMs    int
		wantErr   bool
	}{
		{name: "until-exit only", untilExit: true},
		{name: "contains only", contains: "done"},
		{name: "idle only", idleSet: true, idleMs: 500},
		{name: "none is invalid", wantErr: true},
		{name: "until-exit and contains", untilExit: true, contains: "x", wantErr: true},
		{name: "until-exit and idle", untilExit: true, idleSet: true, idleMs: 100, wantErr: true},
		{name: "contains and idle", contains: "x", idleSet: true, idleMs: 100, wantErr: true},
		{name: "all three", untilExit: true, contains: "x", idleSet: true, idleMs: 100, wantErr: true},
		{name: "idle zero is invalid", idleSet: true, idleMs: 0, wantErr: true},
		{name: "idle negative is invalid", idleSet: true, idleMs: -1, wantErr: true},
		{name: "empty contains without other flags is invalid", contains: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateWaitFlags(tt.untilExit, tt.contains, tt.idleSet, tt.idleMs)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateWaitFlags(%v, %q, %v, %d) error = %v, wantErr %v",
					tt.untilExit, tt.contains, tt.idleSet, tt.idleMs, err, tt.wantErr)
			}
		})
	}
}

func TestParseWaitTimeout(t *testing.T) {
	got, err := parseDurationFlag("", blockWaitDefaultTimeout)
	if err != nil {
		t.Fatalf("parseDurationFlag empty error: %v", err)
	}
	if got != blockWaitDefaultTimeout {
		t.Errorf("empty timeout = %s, want %s", got, blockWaitDefaultTimeout)
	}
	got, err = parseDurationFlag("30s", blockWaitDefaultTimeout)
	if err != nil {
		t.Fatalf("parseDurationFlag 30s error: %v", err)
	}
	if got.Seconds() != 30 {
		t.Errorf("30s = %s, want 30s", got)
	}
}

func TestBlockWaitJSONShape(t *testing.T) {
	out := blockWaitJSONOutput{OK: true, Reason: "exit", ElapsedMs: 42}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}
	if ok, isBool := decoded["ok"].(bool); !isBool || !ok {
		t.Errorf("ok = %v, want true", decoded["ok"])
	}
	if reason, _ := decoded["reason"].(string); reason != "exit" {
		t.Errorf("reason = %v, want %q", decoded["reason"], "exit")
	}
	if elapsed, ok := decoded["elapsedms"].(float64); !ok || int(elapsed) != 42 {
		t.Errorf("elapsedms = %v, want 42", decoded["elapsedms"])
	}
}

func TestScrollbackContains(t *testing.T) {
	tests := []struct {
		name   string
		lines  []string
		substr string
		want   bool
	}{
		{name: "found in one line", lines: []string{"hello", "world"}, substr: "ell", want: true},
		{name: "not found", lines: []string{"hello"}, substr: "xyz", want: false},
		{name: "empty substr matches", lines: []string{"hello"}, substr: "", want: true},
		{name: "spans joined newline", lines: []string{"ab", "cd"}, substr: "b\nc", want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := scrollbackContains(tt.lines, tt.substr)
			if got != tt.want {
				t.Errorf("scrollbackContains(%v, %q) = %v, want %v", tt.lines, tt.substr, got, tt.want)
			}
		})
	}
}

func TestShouldRefuseSendKeys(t *testing.T) {
	const now = int64(10_000)
	tests := []struct {
		name            string
		lastUserInputMs int64
		wantRefuse      bool
		wantAgo         int64
	}{
		{name: "never typed", lastUserInputMs: 0, wantRefuse: false},
		{name: "negative treated as never", lastUserInputMs: -1, wantRefuse: false},
		{name: "typed 1999ms ago refuses", lastUserInputMs: now - 1999, wantRefuse: true, wantAgo: 1999},
		{name: "typed 2000ms ago allows", lastUserInputMs: now - 2000, wantRefuse: false, wantAgo: 2000},
		{name: "typed 1ms ago refuses", lastUserInputMs: now - 1, wantRefuse: true, wantAgo: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ago, refuse := shouldRefuseSendKeys(tt.lastUserInputMs, now, sendKeysHumanInputGuardMs)
			if refuse != tt.wantRefuse {
				t.Errorf("shouldRefuseSendKeys(%d) refuse = %v, want %v", tt.lastUserInputMs, refuse, tt.wantRefuse)
			}
			if refuse && ago != tt.wantAgo {
				t.Errorf("shouldRefuseSendKeys(%d) ago = %d, want %d", tt.lastUserInputMs, ago, tt.wantAgo)
			}
		})
	}
}

func TestValidateScreenshotFlags(t *testing.T) {
	tests := []struct {
		name       string
		outputFile string
		jsonOut    bool
		wantErr    bool
	}{
		{name: "output only", outputFile: "out.png"},
		{name: "json only", jsonOut: true},
		{name: "both", outputFile: "out.png", jsonOut: true},
		{name: "neither is invalid", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateScreenshotFlags(tt.outputFile, tt.jsonOut)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateScreenshotFlags(%q, %v) error = %v, wantErr %v", tt.outputFile, tt.jsonOut, err, tt.wantErr)
			}
		})
	}
}

func TestDecodeScreenshotPNG(t *testing.T) {
	raw := "aGVsbG8=" // "hello"
	t.Run("data url prefix stripped", func(t *testing.T) {
		got, err := decodeScreenshotPNG(pngDataURLPrefix + raw)
		if err != nil {
			t.Fatalf("decodeScreenshotPNG error: %v", err)
		}
		if string(got) != "hello" {
			t.Errorf("decodeScreenshotPNG = %q, want %q", got, "hello")
		}
	})
	t.Run("raw base64", func(t *testing.T) {
		got, err := decodeScreenshotPNG(raw)
		if err != nil {
			t.Fatalf("decodeScreenshotPNG error: %v", err)
		}
		if string(got) != "hello" {
			t.Errorf("decodeScreenshotPNG = %q, want %q", got, "hello")
		}
	})
	t.Run("empty is error", func(t *testing.T) {
		_, err := decodeScreenshotPNG("")
		if err == nil {
			t.Errorf("decodeScreenshotPNG empty: want error")
		}
	})
	t.Run("invalid base64 is error", func(t *testing.T) {
		_, err := decodeScreenshotPNG("not-valid-base64!!!")
		if err == nil {
			t.Errorf("decodeScreenshotPNG invalid: want error")
		}
	})
}

func TestBlockScreenshotJSONShape(t *testing.T) {
	out := blockScreenshotJSONOutput{BlockId: "abc", Bytes: 12, Path: "out.png"}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}
	if id, _ := decoded["blockid"].(string); id != "abc" {
		t.Errorf("blockid = %v, want abc", decoded["blockid"])
	}
	if n, ok := decoded["bytes"].(float64); !ok || int(n) != 12 {
		t.Errorf("bytes = %v, want 12", decoded["bytes"])
	}
	if path, _ := decoded["path"].(string); path != "out.png" {
		t.Errorf("path = %v, want out.png", decoded["path"])
	}
}

func TestBlockDetailsCwdJSON(t *testing.T) {
	out := BlockDetails{
		BlockId: "b1",
		Id:      "block:b1",
		Cwd:     "/home/user/proj",
	}
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error: %v", err)
	}
	if cwd, ok := decoded["cwd"].(string); !ok || cwd != "/home/user/proj" {
		t.Errorf("cwd = %v, want /home/user/proj", decoded["cwd"])
	}

	empty := BlockDetails{BlockId: "b2"}
	bytes, err = json.Marshal(empty)
	if err != nil {
		t.Fatalf("json.Marshal() empty error: %v", err)
	}
	var decodedEmpty map[string]interface{}
	if err := json.Unmarshal(bytes, &decodedEmpty); err != nil {
		t.Fatalf("json.Unmarshal() empty error: %v", err)
	}
	if _, ok := decodedEmpty["cwd"]; ok {
		t.Errorf("empty cwd should be omitted, got %s", string(bytes))
	}
}

func TestPickTabIdForBlockRoute(t *testing.T) {
	tests := []struct {
		name       string
		blockTabId string
		envTabId   string
		want       string
	}{
		{name: "block tab wins over env", blockTabId: "tab-block", envTabId: "tab-env", want: "tab-block"},
		{name: "falls back to env", blockTabId: "", envTabId: "tab-env", want: "tab-env"},
		{name: "both empty", blockTabId: "", envTabId: "", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := pickTabIdForBlockRoute(tt.blockTabId, tt.envTabId)
			if got != tt.want {
				t.Errorf("pickTabIdForBlockRoute(%q, %q) = %q, want %q", tt.blockTabId, tt.envTabId, got, tt.want)
			}
		})
	}
}
