// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package pamparse provides functions for parsing environment files in the format of /etc/environment, /etc/security/pam_env.conf, and ~/.pam_environment.
package pamparse

import (
	"bufio"
	"os"
	"regexp"
	"strings"
)

// Parses a file in the format of /etc/environment. Accepts a path to the file and returns a map of environment variables.
func ParseEnvironmentFile(path string) (map[string]string, error) {
	rtn := make(map[string]string)
	file, err := os.OpenFile(path, os.O_RDONLY, 0)
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
func ParseEnvironmentConfFile(path string) (map[string]string, error) {
	rtn := make(map[string]string)
	file, err := os.OpenFile(path, os.O_RDONLY, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
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
		rtn[key] = val
	}
	return rtn, nil
}

var envFileLineRe = regexp.MustCompile(`^(?:export\s+)?([A-Z0-9_]+[A-Za-z0-9]*)=(.*)$`)

func parseEnvironmentLine(line string) (string, string) {
	m := envFileLineRe.FindStringSubmatch(line)
	if m == nil {
		return "", ""
	}
	return m[1], sanitizeEnvVarValue(m[2])
}

var confFileLineRe = regexp.MustCompile(`^([A-Z0-9_]+[A-Za-z0-9]*)\s+(?:(?:DEFAULT=)([^\s]+(?: \w+)*))\s*(?:(?:OVERRIDE=)([^\s]+(?: \w+)*))?\s*$`)

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
