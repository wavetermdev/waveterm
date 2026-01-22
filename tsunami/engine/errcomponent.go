// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"fmt"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// creates an error component for display when a component panics
func renderErrorComponent(componentName string, errorMsg string) any {
	return vdom.H("div", map[string]any{
		"className": "p-4 border border-red-500 bg-red-100 text-red-800 rounded font-mono",
	},
		vdom.H("div", map[string]any{
			"className": "font-bold mb-2",
		}, fmt.Sprintf("Component Error: %s", componentName)),
		vdom.H("div", nil, errorMsg),
	)
}
