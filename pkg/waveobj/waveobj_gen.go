// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"bytes"
	"fmt"
	"reflect"
	"strings"
)

func getTSFieldName(field reflect.StructField) string {
	jsonTag := field.Tag.Get("json")
	if jsonTag != "" {
		parts := strings.Split(jsonTag, ",")
		namePart := parts[0]
		if namePart != "" {
			if namePart == "-" {
				return ""
			}
			return namePart
		}
		// if namePart is empty, still uses default
	}
	return field.Name
}

func isFieldOmitEmpty(field reflect.StructField) bool {
	jsonTag := field.Tag.Get("json")
	if jsonTag != "" {
		parts := strings.Split(jsonTag, ",")
		if len(parts) > 1 {
			for _, part := range parts[1:] {
				if part == "omitempty" {
					return true
				}
			}
		}
	}
	return false
}

func typeToTSType(t reflect.Type) (string, []reflect.Type) {
	switch t.Kind() {
	case reflect.String:
		return "string", nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return "number", nil
	case reflect.Bool:
		return "boolean", nil
	case reflect.Slice, reflect.Array:
		elemType, subTypes := typeToTSType(t.Elem())
		if elemType == "" {
			return "", nil
		}
		return fmt.Sprintf("%s[]", elemType), subTypes
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return "", nil
		}
		elemType, subTypes := typeToTSType(t.Elem())
		if elemType == "" {
			return "", nil
		}
		return fmt.Sprintf("{[key: string]: %s}", elemType), subTypes
	case reflect.Struct:
		return t.Name(), []reflect.Type{t}
	case reflect.Ptr:
		return typeToTSType(t.Elem())
	case reflect.Interface:
		return "any", nil
	default:
		return "", nil
	}
}

var tsRenameMap = map[string]string{
	"Window": "WaveWindow",
}

func generateTSTypeInternal(rtype reflect.Type) (string, []reflect.Type) {
	var buf bytes.Buffer
	waveObjType := reflect.TypeOf((*WaveObj)(nil)).Elem()
	tsTypeName := rtype.Name()
	if tsRename, ok := tsRenameMap[tsTypeName]; ok {
		tsTypeName = tsRename
	}
	var isWaveObj bool
	if rtype.Implements(waveObjType) || reflect.PointerTo(rtype).Implements(waveObjType) {
		isWaveObj = true
		buf.WriteString(fmt.Sprintf("type %s = WaveObj & {\n", tsTypeName))
	} else {
		buf.WriteString(fmt.Sprintf("type %s = {\n", tsTypeName))
	}
	var subTypes []reflect.Type
	for i := 0; i < rtype.NumField(); i++ {
		field := rtype.Field(i)
		if field.PkgPath != "" {
			continue
		}
		fieldName := getTSFieldName(field)
		if fieldName == "" {
			continue
		}
		if isWaveObj && (fieldName == OTypeKeyName || fieldName == OIDKeyName || fieldName == VersionKeyName) {
			continue
		}
		optMarker := ""
		if isFieldOmitEmpty(field) {
			optMarker = "?"
		}
		tsTypeTag := field.Tag.Get("tstype")
		if tsTypeTag != "" {
			buf.WriteString(fmt.Sprintf("  %s%s: %s;\n", fieldName, optMarker, tsTypeTag))
			continue
		}
		tsType, fieldSubTypes := typeToTSType(field.Type)
		if tsType == "" {
			continue
		}
		subTypes = append(subTypes, fieldSubTypes...)
		buf.WriteString(fmt.Sprintf("  %s%s: %s;\n", fieldName, optMarker, tsType))
	}
	buf.WriteString("};\n")
	return buf.String(), subTypes
}

func GenerateWaveObjTSType() string {
	var buf bytes.Buffer
	buf.WriteString("type WaveObj = {\n")
	buf.WriteString("  otype: string;\n")
	buf.WriteString("  oid: string;\n")
	buf.WriteString("  version: number;\n")
	buf.WriteString("};\n")
	return buf.String()
}

func GenerateTSType(rtype reflect.Type, tsTypesMap map[reflect.Type]string) {
	if rtype == nil {
		return
	}
	if rtype.Kind() == reflect.Ptr {
		rtype = rtype.Elem()
	}
	if _, ok := tsTypesMap[rtype]; ok {
		return
	}
	if rtype == waveObjRType {
		tsTypesMap[rtype] = GenerateWaveObjTSType()
		return
	}
	tsType, subTypes := generateTSTypeInternal(rtype)
	tsTypesMap[rtype] = tsType
	for _, subType := range subTypes {
		GenerateTSType(subType, tsTypesMap)
	}
}
