// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import "github.com/wavetermdev/waveterm/tsunami/vdom"

// so components either render to another component (or fragment)
// or to a base element (text or vdom).  base elements can then render children

type ChildKey struct {
	Tag string
	Idx int
	Key string
}

// ComponentImpl represents a node in the persistent shadow component tree.
// This is Tsunami's equivalent to React's Fiber nodes - it maintains component
// identity, state, and lifecycle across renders while the VDomElem input/output
// structures are ephemeral.
type ComponentImpl struct {
	WaveId  string         // Unique identifier for this component instance
	Tag     string         // Component type (HTML tag, custom component name, "#text", etc.)
	Key     string         // User-provided key for reconciliation (like React keys)
	Elem    *vdom.VDomElem // Reference to the current input VDomElem being rendered
	Mounted bool           // Whether this component is currently mounted

	// Hooks system (React-like)
	Hooks []*Hook // Array of hooks (state, effects, etc.) attached to this component

	// Component content - exactly ONE of these patterns is used:

	// Pattern 1: Text nodes
	Text string // For "#text" components - stores the actual text content

	// Pattern 2: Base/DOM elements with children
	Children []*ComponentImpl // For HTML tags, fragments - array of child components

	// Pattern 3: Custom components that render to other components
	RenderedComp *ComponentImpl // For custom components - points to what this component rendered to
}

func (c *ComponentImpl) compMatch(tag string, key string) bool {
	if c == nil {
		return false
	}
	return c.Tag == tag && c.Key == key
}
