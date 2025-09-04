// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdomctx

import (
	"context"
)

type vdomContextKeyType struct{}

var vdomContextKey = vdomContextKeyType{}

type VDomContext interface {
	UseRenderTs(ctx context.Context) int64
	UseId(ctx context.Context) string
	UseState(ctx context.Context, initialVal any) (any, func(any), func(func(any) any))
	UseAtom(ctx context.Context, atomName string) (any, func(any), func(func(any) any))
	UseVDomRef(ctx context.Context) any
	UseRef(ctx context.Context, initialVal any) any
	UseEffect(ctx context.Context, fn func() func(), deps []any)
	UseResync(ctx context.Context) bool
	UseSetAppTitle(ctx context.Context, title string)
	QueueRefOp(ctx context.Context, op any)
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
