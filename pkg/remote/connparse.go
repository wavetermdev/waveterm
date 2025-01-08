// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import "regexp"

const (
	ConnectionTypeWsh = "wsh"
	ConnectionTypeAws = "aws"
)

var connectionRe = regexp.MustCompile(`^(\w+):\/\/(.*)$`)

func ParseConnectionType(connection string) string {
	connMatch := connectionRe.FindStringSubmatch(connection)
	if connMatch == nil {
		return ConnectionTypeWsh
	}
	return connMatch[1]
}
