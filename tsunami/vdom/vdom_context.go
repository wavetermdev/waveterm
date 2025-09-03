// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
)

type vdomContextKeyType struct{}

var vdomContextKey = vdomContextKeyType{}

type VDomContext interface {
	AddRenderWork(id string)
	AddEffectWork(id string, effectIndex int)
	AtomSetUsedBy(atomName string, waveId string, used bool)
	AtomAddRenderWork(atomName string)
	GetAtomVal(atomName string) any
	SetAtomVal(atomName string, val any, markDirty bool)
	GetRenderTs() int64
	GetCompWaveId() string
	GetOrderedHook() *Hook
	IsResync() bool
	GetCompName() string
	SetAppTitle(title string)
}

func WithRenderContext(ctx context.Context, vc VDomContext) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, vdomContextKey, vc)
}

func GetRenderContext(ctx context.Context) VDomContext {
	v := ctx.Value(vdomContextKey)
	if v == nil {
		return nil
	}
	return v.(VDomContext)
}
