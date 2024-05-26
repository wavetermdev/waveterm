// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/mitchellh/mapstructure"
)

const (
	OTypeKeyName = "otype"
	OIDKeyName   = "oid"
)

type waveObjDesc struct {
	RType    reflect.Type
	OIDField reflect.StructField
}

var globalLock = &sync.Mutex{}
var waveObjMap = make(map[string]*waveObjDesc)
var waveObj WaveObj
var waveObjRType = reflect.TypeOf(&waveObj).Elem()

func RegisterType(w WaveObj) {
	globalLock.Lock()
	defer globalLock.Unlock()
	oidType := w.GetOType()
	if waveObjMap[oidType] != nil {
		panic(fmt.Sprintf("duplicate WaveObj registration: %T", w))
	}
	rtype := reflect.TypeOf(w)
	field := findOIDField(rtype)
	if field == nil {
		panic(fmt.Sprintf("cannot register WaveObj without OID field -- mark with tag `waveobj:\"oid\"`"))
	}
	waveObjMap[oidType] = &waveObjDesc{
		RType:    rtype,
		OIDField: *field,
	}
}

func findOIDField(rtype reflect.Type) *reflect.StructField {
	for idx := 0; idx < rtype.NumField(); idx++ {
		field := rtype.Field(idx)
		if field.PkgPath != "" {
			// private
			continue
		}
		waveObjTag := field.Tag.Get("waveobj")
		if waveObjTag == "oid" {
			if field.Type.Kind() != reflect.String {
				panic(fmt.Sprintf("in %v marked oid field is not type 'string'", rtype))
			}
			return &field
		}
	}
	return nil
}

func getObjDescForOIDType(oidType string) *waveObjDesc {
	globalLock.Lock()
	defer globalLock.Unlock()
	return waveObjMap[oidType]
}

type WaveObj interface {
	GetOType() string
}

func ToJson(w WaveObj) ([]byte, error) {
	m := make(map[string]any)
	err := mapstructure.Decode(w, &m)
	if err != nil {
		return nil, err
	}
	desc := getObjDescForOIDType(w.GetOType())
	if desc == nil {
		return nil, fmt.Errorf("otype %q (%T) not registered", w.GetOType(), w)
	}
	m[OTypeKeyName] = w.GetOType()
	m[OIDKeyName] = reflect.ValueOf(w).FieldByIndex(desc.OIDField.Index).String()
	return json.Marshal(m)
}

func FromJson(data []byte) (WaveObj, error) {
	var m map[string]any
	err := json.Unmarshal(data, &m)
	if err != nil {
		return nil, err
	}
	otype, ok := m[OTypeKeyName].(string)
	if !ok {
		return nil, fmt.Errorf("missing otype")
	}
	oid, ok := m[OIDKeyName].(string)
	if !ok {
		return nil, fmt.Errorf("missing oid")
	}
	desc := getObjDescForOIDType(otype)
	if desc == nil {
		return nil, fmt.Errorf("unknown oid type: %s", otype)
	}
	objVal := reflect.New(desc.RType)
	oidField := objVal.FieldByIndex(desc.OIDField.Index)
	oidField.SetString(oid)
	obj := objVal.Interface().(WaveObj)
	err = mapstructure.Decode(m, obj)
	if err != nil {
		return nil, err
	}
	return obj, nil
}

func FromJsonGen[T WaveObj](data []byte) (T, error) {
	obj, err := FromJson(data)
	if err != nil {
		var zero T
		return zero, err
	}
	rtn, ok := obj.(T)
	if !ok {
		var zero T
		return zero, fmt.Errorf("type mismatch got %T, expected %T", obj, zero)
	}
	return rtn, nil
}

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

func generateTSTypeInternal(rtype reflect.Type) (string, []reflect.Type) {
	var buf bytes.Buffer
	waveObjType := reflect.TypeOf((*WaveObj)(nil)).Elem()
	buf.WriteString(fmt.Sprintf("type %s = {\n", rtype.Name()))
	if rtype.Implements(waveObjType) || reflect.PointerTo(rtype).Implements(waveObjType) {
		buf.WriteString(fmt.Sprintf("  %s: string;\n", OTypeKeyName))
		buf.WriteString(fmt.Sprintf("  %s: string;\n", OIDKeyName))
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
	buf.WriteString("}\n")
	return buf.String(), subTypes
}

func GenerateWaveObjTSType() string {
	var buf bytes.Buffer
	buf.WriteString("type WaveObj {\n")
	buf.WriteString("  otype: string;\n")
	buf.WriteString("  oid: string;\n")
	buf.WriteString("}\n")
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
