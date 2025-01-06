// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package defaultconfig

import "embed"

//go:embed *.json all:*/*.json
var ConfigFS embed.FS
