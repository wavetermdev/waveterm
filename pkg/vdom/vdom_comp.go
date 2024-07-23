// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

// so components either render to another component (or fragment)
// or to a base element (text or vdom).  base elements can then render children

type ChildKey struct {
	Tag string
	Idx int
	Key string
}

type Component struct {
	Id      string
	Tag     string
	Key     string
	Elem    *Elem
	Mounted bool

	// hooks
	Hooks []*Hook

	// #text component
	Text string

	// base component -- vdom, wave elem, or #fragment
	Children []*Component

	// component -> component
	Comp *Component
}

func (c *Component) compMatch(tag string, key string) bool {
	if c == nil {
		return false
	}
	return c.Tag == tag && c.Key == key
}
