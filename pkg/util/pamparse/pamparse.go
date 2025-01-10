// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package pamparse provides functions for parsing environment files in the format of /etc/environment, /etc/security/pam_env.conf, and ~/.pam_environment.
package pamparse

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type PamParseOpts struct {
	Home  string
	Shell string
}

// Parses a file in the format of /etc/environment. Accepts a path to the file and returns a map of environment variables.
func ParseEnvironmentFile(path string) (map[string]string, error) {
	rtn := make(map[string]string)
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		key, val := parseEnvironmentLine(line)
		if key == "" {
			continue
		}
		rtn[key] = val
	}
	return rtn, nil
}

// Parses a file in the format of /etc/security/pam_env.conf or ~/.pam_environment. Accepts a path to the file and returns a map of environment variables.
func ParseEnvironmentConfFile(path string, opts *PamParseOpts) (map[string]string, error) {
	rtn := make(map[string]string)
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if opts == nil {
		opts, err = ParsePasswd()
		if err != nil {
			return nil, err
		}
	}
	if err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		key, val := parseEnvironmentConfLine(line)

		// Fall back to ParseEnvironmentLine if ParseEnvironmentConfLine fails
		if key == "" {
			key, val = parseEnvironmentLine(line)
			if key == "" {
				continue
			}
		}
		rtn[key] = replaceHomeAndShell(val, opts.Home, opts.Shell)
	}
	return rtn, nil
}

// Gets the home directory and shell from /etc/passwd for the current user.
func ParsePasswd() (*PamParseOpts, error) {
	file, err := os.Open("/etc/passwd")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	userPrefix := fmt.Sprintf("%s:", os.Getenv("USER"))
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, userPrefix) {
			parts := strings.Split(line, ":")
			if len(parts) < 7 {
				return nil, fmt.Errorf("invalid passwd entry: insufficient fields")
			}
			return &PamParseOpts{
				Home:  parts[5],
				Shell: parts[6],
			}, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading passwd file: %w", err)
	}
	return nil, nil
}

/*
Gets the home directory and shell from /etc/passwd for the current user and returns a map of environment variables from /etc/security/pam_env.conf or ~/.pam_environment.
Returns nil if an error occurs.
*/
func ParsePasswdSafe() *PamParseOpts {
	opts, err := ParsePasswd()
	if err != nil {
		return nil
	}
	return opts
}

// Replaces @{HOME} and @{SHELL} placeholders in a string with the provided values. Follows guidance from https://wiki.archlinux.org/title/Environment_variables#Using_pam_env
func replaceHomeAndShell(val string, home string, shell string) string {
	val = strings.ReplaceAll(val, "@{HOME}", home)
	val = strings.ReplaceAll(val, "@{SHELL}", shell)
	return val
}

// Regex to parse a line from /etc/environment. Follows the guidance from https://wiki.archlinux.org/title/Environment_variables#Using_pam_env
var envFileLineRe = regexp.MustCompile(`^(?:export\s+)?([A-Z0-9_]+[A-Za-z0-9]*)=(.*)$`)

func parseEnvironmentLine(line string) (string, string) {
	m := envFileLineRe.FindStringSubmatch(line)
	if m == nil {
		return "", ""
	}
	return m[1], sanitizeEnvVarValue(m[2])
}

// Regex to parse a line from /etc/security/pam_env.conf or ~/.pam_environment. Follows the guidance from https://wiki.archlinux.org/title/Environment_variables#Using_pam_env
var confFileLineRe = regexp.MustCompile(`^([A-Z0-9_]+[A-Za-z0-9]*)\s+(?:(?:DEFAULT=)(\S+(?: \S+)*))\s*(?:(?:OVERRIDE=)(\S+(?: \S+)*))?\s*$`)

func parseEnvironmentConfLine(line string) (string, string) {
	m := confFileLineRe.FindStringSubmatch(line)
	if m == nil {
		return "", ""
	}
	var vals []string
	if len(m) > 3 && m[3] != "" {
		vals = []string{sanitizeEnvVarValue(m[3]), sanitizeEnvVarValue(m[2])}
	} else {
		vals = []string{sanitizeEnvVarValue(m[2])}
	}
	return m[1], strings.Join(vals, ":")
}

// Sanitizes an environment variable value by stripping comments and trimming quotes.
func sanitizeEnvVarValue(val string) string {
	return stripComments(trimQuotes(val))
}

// Trims quotes as defined by https://unix.stackexchange.com/questions/748790/where-is-the-syntax-for-etc-environment-documented
func trimQuotes(val string) string {
	if strings.HasPrefix(val, "\"") || strings.HasPrefix(val, "'") {
		val = val[1:]
		if strings.HasSuffix(val, "\"") || strings.HasSuffix(val, "'") {
			val = val[0 : len(val)-1]
		}
	}
	return val
}

// Strips comments as defined by https://unix.stackexchange.com/questions/748790/where-is-the-syntax-for-etc-environment-documented
func stripComments(val string) string {
	commentIdx := strings.Index(val, "#")
	if commentIdx == -1 {
		return val
	}
	return val[0:commentIdx]
}
