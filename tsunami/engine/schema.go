// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/util"
)

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
		var fieldSchema map[string]any
		if fieldInfo.AsString {
			fieldSchema = map[string]any{"type": "string"}
		} else {
			fieldSchema = generateShallowJSONSchema(field.Type, nil)
		}

		// Add description from "desc" tag if present
		if desc := field.Tag.Get("desc"); desc != "" {
			fieldSchema["description"] = desc
		}

		// Add enum values from "enum" tag if present (only for string types)
		if enumTag := field.Tag.Get("enum"); enumTag != "" && fieldSchema["type"] == "string" {
			enumValues := make([]any, 0)
			for _, val := range strings.Split(enumTag, ",") {
				trimmed := strings.TrimSpace(val)
				if trimmed != "" {
					enumValues = append(enumValues, trimmed)
				}
			}
			if len(enumValues) > 0 {
				fieldSchema["enum"] = enumValues
			}
		}

		// Add units from "units" tag if present
		if units := field.Tag.Get("units"); units != "" {
			fieldSchema["units"] = units
		}

		// Add min/max constraints for numeric types
		if fieldSchema["type"] == "number" || fieldSchema["type"] == "integer" {
			if minTag := field.Tag.Get("min"); minTag != "" {
				if minVal, err := strconv.ParseFloat(minTag, 64); err == nil {
					fieldSchema["minimum"] = minVal
				}
			}
			if maxTag := field.Tag.Get("max"); maxTag != "" {
				if maxVal, err := strconv.ParseFloat(maxTag, 64); err == nil {
					fieldSchema["maximum"] = maxVal
				}
			}
		}

		// Add pattern constraint for string types
		if fieldSchema["type"] == "string" {
			if pattern := field.Tag.Get("pattern"); pattern != "" {
				fieldSchema["pattern"] = pattern
			}
		}

		properties[fieldInfo.FieldName] = fieldSchema

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
		// Skip time.Time since we handle it specially
		if t == reflect.TypeOf(time.Time{}) {
			return
		}

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

	// Add enum values if specified (only for string types)
	if len(meta.Enum) > 0 && schema["type"] == "string" {
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
		schema["contentEncoding"] = "base64"
		schema["contentMediaType"] = "application/octet-stream"
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
		schema["$ref"] = fmt.Sprintf("#/$defs/%s", t.Name())
	case reflect.Ptr:
		return generateShallowJSONSchema(t.Elem(), meta)
	case reflect.Interface:
		schema["type"] = "object"
	default:
		schema["type"] = "object"
	}

	return schema
}

// getAtomMeta extracts AtomMeta from the atom
func getAtomMeta(atom genAtom) *AtomMeta {
	return atom.GetMeta()
}

// generateSchemaFromAtoms generates a JSON schema from a map of atoms
func generateSchemaFromAtoms(atoms map[string]genAtom, title, description string) map[string]any {
	// Collect all struct definitions
	defs := make(map[reflect.Type]any)
	for _, atom := range atoms {
		atomType := atom.GetAtomType()
		if atomType != nil {
			collectStructDefs(atomType, defs)
		}
	}

	// Generate properties for each atom
	properties := make(map[string]any)
	for atomName, atom := range atoms {
		atomType := atom.GetAtomType()
		if atomType != nil {
			atomMeta := getAtomMeta(atom)
			properties[atomName] = generateShallowJSONSchema(atomType, atomMeta)
		}
	}

	// Build the final schema
	// schema line unnecessary for AI (and burns tokens)
	// also dropping title since it is mostly redundant
	// also dropping additionalProperties (since AI doesn't need that, and it burns tokens)
	schema := map[string]any{
		// "$schema":              "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		// "title":                title,
		"description": description,
		"properties":  properties,
		// "additionalProperties": false,
	}

	// Add definitions if any
	if len(defs) > 0 {
		definitions := make(map[string]any)
		for t, def := range defs {
			definitions[t.Name()] = def
		}
		schema["$defs"] = definitions
	}

	return schema
}

// GenerateConfigSchema generates a JSON schema for all config atoms
func GenerateConfigSchema(root *RootElem) map[string]any {
	configAtoms := root.getAtomsByPrefix("$config.")
	return generateSchemaFromAtoms(configAtoms, "Application Configuration", "Application configuration settings")
}

// GenerateDataSchema generates a JSON schema for all data atoms
func GenerateDataSchema(root *RootElem) map[string]any {
	dataAtoms := root.getAtomsByPrefix("$data.")
	return generateSchemaFromAtoms(dataAtoms, "Application Data", "Application data schema")
}
