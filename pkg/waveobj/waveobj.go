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
	OTypeKeyName   = "otype"
	OIDKeyName     = "oid"
	VersionKeyName = "version"

	OIDGoFieldName     = "OID"
	VersionGoFieldName = "Version"
)

type ORef struct {
	OType string `json:"otype"`
	OID   string `json:"oid"`
}

type WaveObj interface {
	GetOType() string // should not depend on object state (should work with nil value)
}

type waveObjDesc struct {
	RType        reflect.Type
	OIDField     reflect.StructField
	VersionField reflect.StructField
}

var waveObjMap = sync.Map{}
var waveObjRType = reflect.TypeOf((*WaveObj)(nil)).Elem()

func RegisterType(rtype reflect.Type) {
	if rtype.Kind() != reflect.Ptr {
		panic(fmt.Sprintf("wave object must be a pointer for %v", rtype))
	}
	if !rtype.Implements(waveObjRType) {
		panic(fmt.Sprintf("wave object must implement WaveObj for %v", rtype))
	}
	waveObj := reflect.Zero(rtype).Interface().(WaveObj)
	otype := waveObj.GetOType()
	if otype == "" {
		panic(fmt.Sprintf("otype is empty for %v", rtype))
	}
	oidField, found := rtype.Elem().FieldByName(OIDGoFieldName)
	if !found {
		panic(fmt.Sprintf("missing OID field for %v", rtype))
	}
	if oidField.Type.Kind() != reflect.String {
		panic(fmt.Sprintf("OID field must be string for %v", rtype))
	}
	if oidField.Tag.Get("json") != OIDKeyName {
		panic(fmt.Sprintf("OID field json tag must be %q for %v", OIDKeyName, rtype))
	}
	versionField, found := rtype.Elem().FieldByName(VersionGoFieldName)
	if !found {
		panic(fmt.Sprintf("missing Version field for %v", rtype))
	}
	if versionField.Type.Kind() != reflect.Int {
		panic(fmt.Sprintf("Version field must be int for %v", rtype))
	}
	if versionField.Tag.Get("json") != VersionKeyName {
		panic(fmt.Sprintf("Version field json tag must be %q for %v", VersionKeyName, rtype))
	}
	_, found = waveObjMap.Load(otype)
	if found {
		panic(fmt.Sprintf("otype %q already registered", otype))
	}
	waveObjMap.Store(otype, &waveObjDesc{
		RType:        rtype,
		OIDField:     oidField,
		VersionField: versionField,
	})
}

func getWaveObjDesc(otype string) *waveObjDesc {
	desc, _ := waveObjMap.Load(otype)
	if desc == nil {
		return nil
	}
	return desc.(*waveObjDesc)
}

func GetOID(waveObj WaveObj) string {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return ""
	}
	return reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.OIDField.Index).String()
}

func SetOID(waveObj WaveObj, oid string) {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return
	}
	reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.OIDField.Index).SetString(oid)
}

func GetVersion(waveObj WaveObj) int {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return 0
	}
	return int(reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.VersionField.Index).Int())
}

func SetVersion(waveObj WaveObj, version int) {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return
	}
	reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.VersionField.Index).SetInt(int64(version))
}

func ToJsonMap(w WaveObj) (map[string]any, error) {
	m := make(map[string]any)
	dconfig := &mapstructure.DecoderConfig{
		Result:  &m,
		TagName: "json",
	}
	decoder, err := mapstructure.NewDecoder(dconfig)
	if err != nil {
		return nil, err
	}
	err = decoder.Decode(w)
	if err != nil {
		return nil, err
	}
	m[OTypeKeyName] = w.GetOType()
	m[OIDKeyName] = GetOID(w)
	m[VersionKeyName] = GetVersion(w)
	return m, nil
}

func ToJson(w WaveObj) ([]byte, error) {
	m, err := ToJsonMap(w)
	if err != nil {
		return nil, err
	}
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
	desc := getWaveObjDesc(otype)
	if desc == nil {
		return nil, fmt.Errorf("unknown otype: %s", otype)
	}
	wobj := reflect.Zero(desc.RType).Interface().(WaveObj)
	dconfig := &mapstructure.DecoderConfig{
		Result:  &wobj,
		TagName: "json",
	}
	decoder, err := mapstructure.NewDecoder(dconfig)
	if err != nil {
		return nil, err
	}
	err = decoder.Decode(m)
	if err != nil {
		return nil, err
	}
	return wobj, nil
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
