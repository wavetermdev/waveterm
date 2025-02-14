// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package dbutil

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/sawka/txwrap"
)

type DBMappable interface {
	UseDBMap()
}

type MapEntry[T any] struct {
	Key string
	Val T
}

type MapConverter interface {
	ToMap() map[string]interface{}
	FromMap(map[string]interface{}) bool
}

type HasSimpleKey interface {
	GetSimpleKey() string
}

type HasSimpleInt64Key interface {
	GetSimpleKey() int64
}

type MapConverterPtr[T any] interface {
	MapConverter
	*T
}

type DBMappablePtr[T any] interface {
	DBMappable
	*T
}

func FromMap[PT MapConverterPtr[T], T any](m map[string]any) PT {
	if len(m) == 0 {
		return nil
	}
	rtn := PT(new(T))
	ok := rtn.FromMap(m)
	if !ok {
		return nil
	}
	return rtn
}

func GetMapGen[PT MapConverterPtr[T], T any](tx *txwrap.TxWrap, query string, args ...interface{}) PT {
	m := tx.GetMap(query, args...)
	return FromMap[PT](m)
}

func GetMappable[PT DBMappablePtr[T], T any](tx *txwrap.TxWrap, query string, args ...interface{}) PT {
	m := tx.GetMap(query, args...)
	if len(m) == 0 {
		return nil
	}
	rtn := PT(new(T))
	FromDBMap(rtn, m)
	return rtn
}

func SelectMappable[PT DBMappablePtr[T], T any](tx *txwrap.TxWrap, query string, args ...interface{}) []PT {
	var rtn []PT
	marr := tx.SelectMaps(query, args...)
	for _, m := range marr {
		if len(m) == 0 {
			continue
		}
		val := PT(new(T))
		FromDBMap(val, m)
		rtn = append(rtn, val)
	}
	return rtn
}

func SelectMapsGen[PT MapConverterPtr[T], T any](tx *txwrap.TxWrap, query string, args ...interface{}) []PT {
	var rtn []PT
	marr := tx.SelectMaps(query, args...)
	for _, m := range marr {
		val := FromMap[PT](m)
		if val != nil {
			rtn = append(rtn, val)
		}
	}
	return rtn
}

func SelectSimpleMap[T any](tx *txwrap.TxWrap, query string, args ...interface{}) map[string]T {
	var rtn []MapEntry[T]
	tx.Select(&rtn, query, args...)
	if len(rtn) == 0 {
		return nil
	}
	rtnMap := make(map[string]T)
	for _, entry := range rtn {
		rtnMap[entry.Key] = entry.Val
	}
	return rtnMap
}

func MakeGenMap[T HasSimpleKey](arr []T) map[string]T {
	rtn := make(map[string]T)
	for _, val := range arr {
		rtn[val.GetSimpleKey()] = val
	}
	return rtn
}

func MakeGenMapInt64[T HasSimpleInt64Key](arr []T) map[int64]T {
	rtn := make(map[int64]T)
	for _, val := range arr {
		rtn[val.GetSimpleKey()] = val
	}
	return rtn
}

func isStructType(rt reflect.Type) bool {
	if rt.Kind() == reflect.Struct {
		return true
	}
	if rt.Kind() == reflect.Pointer && rt.Elem().Kind() == reflect.Struct {
		return true
	}
	return false
}

func isByteArrayType(t reflect.Type) bool {
	return t.Kind() == reflect.Slice && t.Elem().Kind() == reflect.Uint8
}

func isStringMapType(t reflect.Type) bool {
	return t.Kind() == reflect.Map && t.Key().Kind() == reflect.String
}

func ToDBMap(v DBMappable, useBytes bool) map[string]interface{} {
	if CheckNil(v) {
		return nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Pointer {
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		panic(fmt.Sprintf("invalid type %T (non-struct) passed to StructToDBMap", v))
	}
	rt := rv.Type()
	m := make(map[string]interface{})
	numFields := rt.NumField()
	for i := 0; i < numFields; i++ {
		field := rt.Field(i)
		fieldVal := rv.FieldByIndex(field.Index)
		dbName := field.Tag.Get("dbmap")
		if dbName == "" {
			dbName = strings.ToLower(field.Name)
		}
		if dbName == "-" {
			continue
		}
		if isByteArrayType(field.Type) {
			m[dbName] = fieldVal.Interface()
		} else if field.Type.Kind() == reflect.Slice {
			if useBytes {
				m[dbName] = QuickJsonArrBytes(fieldVal.Interface())
			} else {
				m[dbName] = QuickJsonArr(fieldVal.Interface())
			}
		} else if isStructType(field.Type) || isStringMapType(field.Type) {
			if useBytes {
				m[dbName] = QuickJsonBytes(fieldVal.Interface())
			} else {
				m[dbName] = QuickJson(fieldVal.Interface())
			}
		} else {
			m[dbName] = fieldVal.Interface()
		}
	}
	return m
}

func FromDBMap(v DBMappable, m map[string]interface{}) {
	if CheckNil(v) {
		panic("StructFromDBMap, v cannot be nil")
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Pointer {
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		panic(fmt.Sprintf("invalid type %T (non-struct) passed to StructFromDBMap", v))
	}
	rt := rv.Type()
	numFields := rt.NumField()
	for i := 0; i < numFields; i++ {
		field := rt.Field(i)
		fieldVal := rv.FieldByIndex(field.Index)
		dbName := field.Tag.Get("dbmap")
		if dbName == "" {
			dbName = strings.ToLower(field.Name)
		}
		if dbName == "-" {
			continue
		}
		if isByteArrayType(field.Type) {
			barrVal := fieldVal.Addr().Interface()
			QuickSetBytes(barrVal.(*[]byte), m, dbName)
		} else if field.Type.Kind() == reflect.Slice {
			QuickSetJsonArr(fieldVal.Addr().Interface(), m, dbName)
		} else if isStructType(field.Type) || isStringMapType(field.Type) {
			QuickSetJson(fieldVal.Addr().Interface(), m, dbName)
		} else if field.Type.Kind() == reflect.String {
			strVal := fieldVal.Addr().Interface()
			QuickSetStr(strVal.(*string), m, dbName)
		} else if field.Type.Kind() == reflect.Int64 {
			intVal := fieldVal.Addr().Interface()
			QuickSetInt64(intVal.(*int64), m, dbName)
		} else if field.Type.Kind() == reflect.Int {
			intVal := fieldVal.Addr().Interface()
			QuickSetInt(intVal.(*int), m, dbName)
		} else if field.Type.Kind() == reflect.Bool {
			boolVal := fieldVal.Addr().Interface()
			QuickSetBool(boolVal.(*bool), m, dbName)
		} else {
			panic(fmt.Sprintf("StructFromDBMap invalid field type %v in %T", fieldVal.Type(), v))
		}
	}
}
