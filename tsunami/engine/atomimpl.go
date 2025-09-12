// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"time"
	
	"github.com/wavetermdev/waveterm/tsunami/util"
)

// AtomMeta provides metadata about an atom for validation and documentation
type AtomMeta struct {
	Description string   // short, user-facing
	Units       string   // "ms", "GiB", etc.
	Min         *float64 // optional minimum (numeric types)
	Max         *float64 // optional maximum (numeric types)
	Enum        []string // allowed values if finite set
	Pattern     string   // regex constraint for strings
}

type AtomImpl[T any] struct {
	lock   *sync.Mutex
	val    T
	usedBy map[string]bool // component waveid -> true
	meta   *AtomMeta       // optional metadata
}

func MakeAtomImpl[T any](initialVal T, meta *AtomMeta) *AtomImpl[T] {
	return &AtomImpl[T]{
		lock:   &sync.Mutex{},
		val:    initialVal,
		usedBy: make(map[string]bool),
		meta:   meta,
	}
}

func (a *AtomImpl[T]) GetVal() any {
	a.lock.Lock()
	defer a.lock.Unlock()
	return a.val
}

func (a *AtomImpl[T]) setVal_nolock(val any) error {
	if val == nil {
		var zero T
		a.val = zero
		return nil
	}

	// Try direct assignment if it's already type T
	if typed, ok := val.(T); ok {
		a.val = typed
		return nil
	}

	// Try JSON marshaling/unmarshaling
	jsonBytes, err := json.Marshal(val)
	if err != nil {
		var result T
		return fmt.Errorf("failed to adapt type from %T => %T, input type failed to marshal: %w", val, result, err)
	}

	var result T
	if err := json.Unmarshal(jsonBytes, &result); err != nil {
		return fmt.Errorf("failed to adapt type from %T => %T: %w", val, result, err)
	}

	a.val = result
	return nil
}

func (a *AtomImpl[T]) SetVal(val any) error {
	a.lock.Lock()
	defer a.lock.Unlock()
	return a.setVal_nolock(val)
}

func (a *AtomImpl[T]) SetUsedBy(waveId string, used bool) {
	a.lock.Lock()
	defer a.lock.Unlock()
	if used {
		a.usedBy[waveId] = true
	} else {
		delete(a.usedBy, waveId)
	}
}

func (a *AtomImpl[T]) GetUsedBy() []string {
	a.lock.Lock()
	defer a.lock.Unlock()

	keys := make([]string, 0, len(a.usedBy))
	for compId := range a.usedBy {
		keys = append(keys, compId)
	}
	return keys
}

// createStructDefinition creates a JSON schema definition for a struct type
func createStructDefinition(t reflect.Type) map[string]any {
	structDef := make(map[string]any)
	structDef["type"] = "object"
	properties := make(map[string]any)
	required := make([]string, 0)
	
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		
		// Parse JSON tag
		fieldInfo, shouldInclude := util.ParseJSONTag(field)
		if !shouldInclude {
			continue // Skip this field
		}
		
		// If field has "string" option, force schema type to string
		if fieldInfo.AsString {
			fieldSchema := map[string]any{"type": "string"}
			properties[fieldInfo.FieldName] = fieldSchema
		} else {
			properties[fieldInfo.FieldName] = generateShallowJSONSchema(field.Type, nil)
		}
		
		// Add to required if not a pointer and not marked as omitempty
		if field.Type.Kind() != reflect.Ptr && !fieldInfo.OmitEmpty {
			required = append(required, fieldInfo.FieldName)
		}
	}
	
	if len(properties) > 0 {
		structDef["properties"] = properties
	}
	if len(required) > 0 {
		structDef["required"] = required
	}
	
	return structDef
}

// collectStructDefs walks the type tree and adds struct definitions to defs map
func collectStructDefs(t reflect.Type, defs map[reflect.Type]any) {
	switch t.Kind() {
	case reflect.Slice, reflect.Array:
		if t.Elem() != nil {
			collectStructDefs(t.Elem(), defs)
		}
	case reflect.Map:
		if t.Elem() != nil {
			collectStructDefs(t.Elem(), defs)
		}
	case reflect.Struct:
		// Skip if we already have this struct definition
		if _, exists := defs[t]; exists {
			return
		}
		
		// Create the struct definition
		structDef := createStructDefinition(t)
		
		// Add the definition before recursing into field types
		defs[t] = structDef
		
		// Now recurse into field types to collect their struct definitions
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			if field.IsExported() {
				_, shouldInclude := util.ParseJSONTag(field)
				if shouldInclude {
					collectStructDefs(field.Type, defs)
				}
			}
		}
	case reflect.Ptr:
		collectStructDefs(t.Elem(), defs)
	}
}

// annotateSchemaWithAtomMeta applies AtomMeta annotations to a JSON schema
func annotateSchemaWithAtomMeta(schema map[string]any, meta *AtomMeta) {
	if meta == nil {
		return
	}
	
	if meta.Description != "" {
		schema["description"] = meta.Description
	}
	
	if meta.Units != "" {
		schema["units"] = meta.Units
	}
	
	// Add numeric constraints for number/integer types
	if schema["type"] == "number" || schema["type"] == "integer" {
		if meta.Min != nil {
			schema["minimum"] = *meta.Min
		}
		if meta.Max != nil {
			schema["maximum"] = *meta.Max
		}
	}
	
	// Add enum values if specified
	if len(meta.Enum) > 0 {
		enumValues := make([]any, len(meta.Enum))
		for i, v := range meta.Enum {
			enumValues[i] = v
		}
		schema["enum"] = enumValues
	}
	
	// Add pattern constraint for strings
	if schema["type"] == "string" && meta.Pattern != "" {
		schema["pattern"] = meta.Pattern
	}
}

// generateShallowJSONSchema creates a schema that references definitions instead of recursing
func generateShallowJSONSchema(t reflect.Type, meta *AtomMeta) map[string]any {
	schema := make(map[string]any)
	defer func() {
		annotateSchemaWithAtomMeta(schema, meta)
	}()
	
	// Special case for time.Time - treat as string with date-time format
	if t == reflect.TypeOf(time.Time{}) {
		schema["type"] = "string"
		schema["format"] = "date-time"
		return schema
	}
	
	// Special case for []byte - treat as string with base64 encoding
	if t.Kind() == reflect.Slice && t.Elem().Kind() == reflect.Uint8 {
		schema["type"] = "string"
		schema["format"] = "base64"
		return schema
	}
	
	switch t.Kind() {
	case reflect.String:
		schema["type"] = "string"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		 reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		schema["type"] = "integer"
	case reflect.Float32, reflect.Float64:
		schema["type"] = "number"
	case reflect.Bool:
		schema["type"] = "boolean"
	case reflect.Slice, reflect.Array:
		schema["type"] = "array"
		if t.Elem() != nil {
			schema["items"] = generateShallowJSONSchema(t.Elem(), nil)
		}
	case reflect.Map:
		schema["type"] = "object"
		if t.Elem() != nil {
			schema["additionalProperties"] = generateShallowJSONSchema(t.Elem(), nil)
		}
	case reflect.Struct:
		// Reference the definition instead of recursing
		schema["$ref"] = fmt.Sprintf("#/definitions/%s", t.Name())
	case reflect.Ptr:
		return generateShallowJSONSchema(t.Elem(), meta)
	case reflect.Interface:
		schema["type"] = "object"
	default:
		schema["type"] = "object"
	}
	
	return schema
}
