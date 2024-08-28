// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package defaultconfig

import "embed"

//go:embed *.json
var ConfigFS embed.FS
