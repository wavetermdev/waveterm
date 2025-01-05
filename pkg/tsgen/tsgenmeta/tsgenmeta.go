// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgenmeta

import "reflect"

type MethodMeta struct {
	Desc       string
	ArgNames   []string
	ReturnDesc string
}

type TypeUnionMeta struct {
	BaseType      reflect.Type
	Desc          string
	TypeFieldName string
	Types         []reflect.Type
}
