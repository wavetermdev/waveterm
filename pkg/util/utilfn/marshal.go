// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/mitchellh/mapstructure"
)

// MarshalIndentNoHTMLString marshals the value to JSON with indentation and SetEscapeHTML(false), returning a string
func MarshalIndentNoHTMLString(v any, prefix, indent string) (string, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent(prefix, indent)
	err := encoder.Encode(v)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

func MustPrettyPrintJSON(v any) string {
	str, _ := MarshalIndentNoHTMLString(v, "", "  ")
	return str
}

func ReUnmarshal(out any, in any) error {
	barr, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(barr, out)
}

// does a mapstructure using "json" tags
func DoMapStructure(out any, input any) error {
	dconfig := &mapstructure.DecoderConfig{
		Result:  out,
		TagName: "json",
	}
	decoder, err := mapstructure.NewDecoder(dconfig)
	if err != nil {
		return err
	}
	return decoder.Decode(input)
}

func MapToStruct(in map[string]any, out any) error {
	// Check that out is a pointer
	outValue := reflect.ValueOf(out)
	if outValue.Kind() != reflect.Ptr {
		return fmt.Errorf("out parameter must be a pointer, got %v", outValue.Kind())
	}

	// Get the struct it points to
	elem := outValue.Elem()
	if elem.Kind() != reflect.Struct {
		return fmt.Errorf("out parameter must be a pointer to struct, got pointer to %v", elem.Kind())
	}

	// Get type information
	typ := elem.Type()

	// For each field in the struct
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)

		// Skip unexported fields
		if !field.IsExported() {
			continue
		}

		name := getJSONName(field)
		if value, ok := in[name]; ok {
			if err := setValue(elem.Field(i), value); err != nil {
				return fmt.Errorf("error setting field %s: %w", name, err)
			}
		}
	}

	return nil
}

func StructToMap(in any) (map[string]any, error) {
	// Get value and handle pointer
	val := reflect.ValueOf(in)
	if val.Kind() == reflect.Ptr {
		val = val.Elem()
	}

	// Check that we have a struct
	if val.Kind() != reflect.Struct {
		return nil, fmt.Errorf("input must be a struct or pointer to struct, got %v", val.Kind())
	}

	// Get type information
	typ := val.Type()
	out := make(map[string]any)

	// For each field in the struct
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)

		// Skip unexported fields
		if !field.IsExported() {
			continue
		}

		name := getJSONName(field)
		out[name] = val.Field(i).Interface()
	}

	return out, nil
}

// getJSONName returns the field name to use for JSON mapping
func getJSONName(field reflect.StructField) string {
	tag := field.Tag.Get("json")
	if tag == "" || tag == "-" {
		return field.Name
	}
	return strings.Split(tag, ",")[0]
}

// setValue attempts to set a reflect.Value with a given interface{} value
func setValue(field reflect.Value, value any) error {
	if value == nil {
		return nil
	}

	valueRef := reflect.ValueOf(value)

	// Direct assignment if types are exactly equal
	if valueRef.Type() == field.Type() {
		field.Set(valueRef)
		return nil
	}

	// Check if types are assignable
	if valueRef.Type().AssignableTo(field.Type()) {
		field.Set(valueRef)
		return nil
	}

	// If field is pointer and value isn't already a pointer, try address
	if field.Kind() == reflect.Ptr && valueRef.Kind() != reflect.Ptr {
		return setValue(field, valueRef.Addr().Interface())
	}

	// Try conversion if types are convertible
	if valueRef.Type().ConvertibleTo(field.Type()) {
		field.Set(valueRef.Convert(field.Type()))
		return nil
	}

	return fmt.Errorf("cannot set value of type %v to field of type %v", valueRef.Type(), field.Type())
}
