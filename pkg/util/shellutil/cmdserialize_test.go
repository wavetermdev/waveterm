// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellutil

import (
	"bytes"
	"os/exec"
	"strings"
	"testing"
)

func TestSerializeCommandForShell_Basic(t *testing.T) {
	tests := []struct {
		name      string
		shellType string
		argv      []string
		want      string
	}{
		{
			name:      "empty argv",
			shellType: ShellType_bash,
			argv:      nil,
			want:      "",
		},
		{
			name:      "simple safe argv",
			shellType: ShellType_bash,
			argv:      []string{"/bin/bash", "-c", "true"},
			want:      `/bin/bash -c true`,
		},
		{
			name:      "argument with spaces",
			shellType: ShellType_bash,
			argv:      []string{"/bin/bash", "-c", "tmux attach -t cc-pp-gatefix"},
			want:      `/bin/bash -c "tmux attach -t cc-pp-gatefix"`,
		},
		{
			name:      "argument with double quotes and dollar",
			shellType: ShellType_bash,
			argv:      []string{"echo", `it's "quoted" $HOME`},
			want:      "echo \"it's \\\"quoted\\\" \\$HOME\"",
		},
		{
			name:      "fish outer shell",
			shellType: ShellType_fish,
			argv:      []string{"echo", "a b"},
			want:      `echo "a b"`,
		},
		{
			name:      "pwsh outer shell gets call operator",
			shellType: ShellType_pwsh,
			argv:      []string{"C:\\wave pwsh.ps1", "-File", "a b"},
			want:      "& \"C:\\wave pwsh.ps1\" \"-File\" \"a b\"",
		},
		{
			name:      "unknown outer shell type falls back to POSIX quoting",
			shellType: ShellType_unknown,
			argv:      []string{"sh", "-c", "a b"},
			want:      `sh -c "a b"`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SerializeCommandForShell(tt.shellType, tt.argv)
			if got != tt.want {
				t.Errorf("SerializeCommandForShell(%q, %v) = %q, want %q", tt.shellType, tt.argv, got, tt.want)
			}
		})
	}
}

// This is the exact bug class SerializeCommandForShell exists to close: the
// old code built cmdCombined via `shellPath + " " + strings.Join(shellOpts, " ")`
// with no quoting at all, so `shellOpts = ["-c", "tmux attach -t foo"]` became
// `bash -c tmux attach -t foo` — "-c" only captured "tmux" as bash's command
// string, and "attach -t foo" leaked in as extra positional args ($1, $2...).
func TestSerializeCommandForShell_OldConstructionWasBroken(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not available")
	}
	shellPath := "/bin/bash"
	// cmdStr as it would arrive from a caller like `wsh run -- echo marker-a marker-b`:
	// one string that must reach bash's "-c" as a SINGLE argument.
	shellOpts := []string{"-c", "echo marker-a marker-b"}
	want := "marker-a marker-b"

	// Old construction: unquoted flatten. "-c" ends up bound to just "echo",
	// and "marker-a marker-b" leak in as bash's $1/$2 (unreferenced by the
	// script), so the echo prints nothing instead of the expected words.
	oldCmdCombined := shellPath + " " + strings.Join(shellOpts, " ")
	out, err := exec.Command("sh", "-c", oldCmdCombined).Output()
	if err != nil {
		t.Fatalf("old construction errored unexpectedly: %v", err)
	}
	got := strings.TrimSpace(string(out))
	if got == want {
		t.Fatalf("expected the old unquoted construction to lose argv boundaries, but it round-tripped correctly: %q", got)
	}

	// New construction: SerializeCommandForShell hard-quotes the cmdStr as a
	// single argv element, so bash's "-c" receives it whole.
	newCmdCombined := SerializeCommandForShell(ShellType_unknown, append([]string{shellPath}, shellOpts...))
	out, err = exec.Command("sh", "-c", newCmdCombined).Output()
	if err != nil {
		t.Fatalf("new construction failed: %v", err)
	}
	got = strings.TrimSpace(string(out))
	if got != want {
		t.Fatalf("new construction did not preserve the cmdStr as a single -c argument: got %q, want %q", got, want)
	}
}

// TestSerializeCommandForShell_FuzzAgainstRealShell is the fuzz/property test:
// for arbitrary argv elements (subject to the constraints os/exec already
// imposes — no NUL bytes), serializing with SerializeCommandForShell for a
// POSIX outer shell and running the result through a real `sh -c` must
// reproduce the exact original argv, byte for byte. This is what proves the
// serializer is round-trip-safe against a REAL shell's parser, not just our
// own assumptions about POSIX quoting rules.
func TestSerializeCommandForShell_FuzzAgainstRealShell(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	seeds := [][]string{
		{"a b"},
		{`c"d`},
		{"e$f"},
		{"g`h`"},
		{`i\j`},
		{""},
		{"~/k"},
		{"-l"},
		{"tab\ttab"},
		{"new\nline"},
		{"multi", "arg", "case", "with spaces", `"quoted"`, "$VAR", "`cmd`", `\`, "~"},
		{"unicode: héllo wörld 日本語"},
	}
	for _, args := range seeds {
		t.Run(strings.Join(args, "|"), func(t *testing.T) {
			assertRoundTrip(t, args)
		})
	}
}

func FuzzSerializeCommandForShell(f *testing.F) {
	if _, err := exec.LookPath("sh"); err != nil {
		f.Skip("sh not available")
	}
	f.Add("simple")
	f.Add("has space")
	f.Add(`has "double" quotes`)
	f.Add("has $dollar and `backtick`")
	f.Add("has \\backslash\\")
	f.Add("")
	f.Add("~tilde")
	f.Add("-dash-leading")
	f.Add("multi\nline\ttabbed")
	f.Fuzz(func(t *testing.T, arg string) {
		if strings.ContainsRune(arg, 0) {
			t.Skip("NUL bytes cannot appear in argv elements")
		}
		if strings.ContainsRune(arg, '\x1e') {
			t.Skip("test harness uses \\x1e as its own output delimiter, not a real serializer constraint")
		}
		assertRoundTrip(t, []string{arg})
	})
}

// assertRoundTrip serializes ["printf", "%s\x1e", args...] for a POSIX outer
// shell, executes it via a real `sh -c`, and asserts the printed, \x1e-split
// output exactly matches args.
func assertRoundTrip(t *testing.T, args []string) {
	t.Helper()
	argv := append([]string{"printf", "%s\x1e"}, args...)
	cmdLine := SerializeCommandForShell(ShellType_unknown, argv)
	out, err := exec.Command("sh", "-c", cmdLine).Output()
	if err != nil {
		t.Fatalf("sh -c %q failed: %v", cmdLine, err)
	}
	trimmed := bytes.TrimSuffix(out, []byte("\x1e"))
	var got []string
	if len(trimmed) > 0 || len(args) > 0 {
		got = strings.Split(string(trimmed), "\x1e")
	}
	if len(args) == 0 {
		return
	}
	if len(got) != len(args) {
		t.Fatalf("cmdLine=%q: got %d args %q, want %d args %q", cmdLine, len(got), got, len(args), args)
	}
	for i := range args {
		if got[i] != args[i] {
			t.Fatalf("cmdLine=%q: arg[%d] = %q, want %q", cmdLine, i, got[i], args[i])
		}
	}
}
