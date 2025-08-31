// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpc

func MakeFeBlockRouteId(blockId string) string {
	return "feblock:" + blockId
}