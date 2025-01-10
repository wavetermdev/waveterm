// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pamparse_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/pamparse"
)

// Tests influenced by https://unix.stackexchange.com/questions/748790/where-is-the-syntax-for-etc-environment-documented
func TestParseEnvironmentFile(t *testing.T) {
	const fileContent = `
FOO1=bar
FOO2="bar"
FOO3="bar
FOO4=bar"
FOO5='bar'
FOO6='bar"
export FOO7=bar
FOO8=bar bar bar
#FOO9=bar
FOO10=$PATH
FOO11="foo#bar"
	`

	// create a temporary file with the content
	tempFile := filepath.Join(t.TempDir(), "pam_env")
	if err := os.WriteFile(tempFile, []byte(fileContent), 0644); err != nil {
		t.Fatalf("failed to write file: %v", err)
	}

	// parse the file
	got, err := pamparse.ParseEnvironmentFile(tempFile)
	if err != nil {
		t.Fatalf("failed to parse pam environment file: %v", err)
	}

	want := map[string]string{
		"FOO1":  "bar",
		"FOO2":  "bar",
		"FOO3":  "bar",
		"FOO4":  "bar\"",
		"FOO5":  "bar",
		"FOO6":  "bar",
		"FOO7":  "bar",
		"FOO8":  "bar bar bar",
		"FOO10": "$PATH",
		"FOO11": "foo",
	}

	if len(got) != len(want) {
		t.Fatalf("expected %d environment variables, got %d", len(want), len(got))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("expected %q to be %q, got %q", k, v, got[k])
		}
	}
}

func TestParseEnvironmentConfFile(t *testing.T) {
	const fileContent = `
TEST   DEFAULT=@{HOME}/.config\ state   OVERRIDE=./config\ s
FOO   DEFAULT=@{HOME}/.config\ s
STRING   DEFAULT="string"
STRINGOVERRIDE   DEFAULT="string"   OVERRIDE="string2"
FOO11="foo#bar"
	`

	// create a temporary file with the content
	tempFile := filepath.Join(t.TempDir(), "pam_env_conf")
	if err := os.WriteFile(tempFile, []byte(fileContent), 0644); err != nil {
		t.Fatalf("failed to write file: %v", err)
	}

	// parse the file
	got, err := pamparse.ParseEnvironmentConfFile(tempFile)
	if err != nil {
		t.Fatalf("failed to parse pam environment conf file: %v", err)
	}

	want := map[string]string{
		"TEST":           "./config\\ s:@{HOME}/.config\\ state",
		"FOO":            "@{HOME}/.config\\ s",
		"STRING":         "string",
		"STRINGOVERRIDE": "string2:string",
		"FOO11":          "foo",
	}

	if len(got) != len(want) {
		t.Fatalf("expected %d environment variables, got %d", len(want), len(got))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("expected %q to be %q, got %q", k, v, got[k])
		}
	}
}
