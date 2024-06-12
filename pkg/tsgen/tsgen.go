// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgen

import (
	"bytes"
	"context"
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/service"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

var contextRType = reflect.TypeOf((*context.Context)(nil)).Elem()
var errorRType = reflect.TypeOf((*error)(nil)).Elem()
var anyRType = reflect.TypeOf((*interface{})(nil)).Elem()
var metaRType = reflect.TypeOf((*map[string]any)(nil)).Elem()
var uiContextRType = reflect.TypeOf((*wstore.UIContext)(nil)).Elem()
var waveObjRType = reflect.TypeOf((*waveobj.WaveObj)(nil)).Elem()
var updatesRtnRType = reflect.TypeOf(wstore.UpdatesRtnType{})

func generateTSMethodTypes(method reflect.Method, tsTypesMap map[reflect.Type]string) error {
	for idx := 1; idx < method.Type.NumIn(); idx++ {
		// skip receiver
		inType := method.Type.In(idx)
		GenerateTSType(inType, tsTypesMap)
	}
	for idx := 0; idx < method.Type.NumOut(); idx++ {
		outType := method.Type.Out(idx)
		GenerateTSType(outType, tsTypesMap)
	}
	return nil
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

func TypeToTSType(t reflect.Type, tsTypesMap map[reflect.Type]string) (string, []reflect.Type) {
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
		elemType, subTypes := TypeToTSType(t.Elem(), tsTypesMap)
		if elemType == "" {
			return "", nil
		}
		return fmt.Sprintf("%s[]", elemType), subTypes
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return "", nil
		}
		if t == metaRType {
			return "MetaType", nil
		}
		elemType, subTypes := TypeToTSType(t.Elem(), tsTypesMap)
		if elemType == "" {
			return "", nil
		}
		return fmt.Sprintf("{[key: string]: %s}", elemType), subTypes
	case reflect.Struct:
		return t.Name(), []reflect.Type{t}
	case reflect.Ptr:
		return TypeToTSType(t.Elem(), tsTypesMap)
	case reflect.Interface:
		if _, ok := tsTypesMap[t]; ok {
			return t.Name(), nil
		}
		return "any", nil
	default:
		return "", nil
	}
}

var tsRenameMap = map[string]string{
	"Window": "WaveWindow",
}

func generateTSTypeInternal(rtype reflect.Type, tsTypesMap map[reflect.Type]string) (string, []reflect.Type) {
	var buf bytes.Buffer
	waveObjType := reflect.TypeOf((*waveobj.WaveObj)(nil)).Elem()
	tsTypeName := rtype.Name()
	if tsRename, ok := tsRenameMap[tsTypeName]; ok {
		tsTypeName = tsRename
	}
	var isWaveObj bool
	buf.WriteString(fmt.Sprintf("// %s\n", rtype.String()))
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
		if isWaveObj && (fieldName == waveobj.OTypeKeyName || fieldName == waveobj.OIDKeyName || fieldName == waveobj.VersionKeyName) {
			continue
		}
		optMarker := ""
		if isFieldOmitEmpty(field) {
			optMarker = "?"
		}
		tsTypeTag := field.Tag.Get("tstype")
		if tsTypeTag != "" {
			buf.WriteString(fmt.Sprintf("    %s%s: %s;\n", fieldName, optMarker, tsTypeTag))
			continue
		}
		tsType, fieldSubTypes := TypeToTSType(field.Type, tsTypesMap)
		if tsType == "" {
			continue
		}
		subTypes = append(subTypes, fieldSubTypes...)
		if tsType == "UIContext" {
			optMarker = "?"
		}
		buf.WriteString(fmt.Sprintf("    %s%s: %s;\n", fieldName, optMarker, tsType))
	}
	buf.WriteString("};\n")
	return buf.String(), subTypes
}

func GenerateWaveObjTSType() string {
	var buf bytes.Buffer
	buf.WriteString("// waveobj.WaveObj\n")
	buf.WriteString("type WaveObj = {\n")
	buf.WriteString("    otype: string;\n")
	buf.WriteString("    oid: string;\n")
	buf.WriteString("    version: number;\n")
	buf.WriteString("};\n")
	return buf.String()
}

func GenerateMetaType() string {
	return "type MetaType = {[key: string]: any}\n"
}

func GenerateTSTypeUnion(unionMeta tsgenmeta.TypeUnionMeta, tsTypeMap map[reflect.Type]string) {
	rtn := generateTSTypeUnionInternal(unionMeta)
	tsTypeMap[unionMeta.BaseType] = rtn
	for _, rtype := range unionMeta.Types {
		GenerateTSType(rtype, tsTypeMap)
	}
}

func generateTSTypeUnionInternal(unionMeta tsgenmeta.TypeUnionMeta) string {
	var buf bytes.Buffer
	if unionMeta.Desc != "" {
		buf.WriteString(fmt.Sprintf("// %s\n", unionMeta.Desc))
	}
	buf.WriteString(fmt.Sprintf("type %s = {\n", unionMeta.BaseType.Name()))
	buf.WriteString(fmt.Sprintf("    %s: string;\n", unionMeta.TypeFieldName))
	buf.WriteString("} & ( ")
	for idx, rtype := range unionMeta.Types {
		if idx > 0 {
			buf.WriteString(" | ")
		}
		buf.WriteString(rtype.Name())
	}
	buf.WriteString(" );\n")
	return buf.String()
}

func GenerateTSType(rtype reflect.Type, tsTypesMap map[reflect.Type]string) {
	if rtype == nil {
		return
	}
	if rtype == metaRType {
		tsTypesMap[metaRType] = GenerateMetaType()
		return
	}
	if rtype == contextRType || rtype == errorRType || rtype == anyRType {
		return
	}
	if rtype.Kind() == reflect.Slice {
		rtype = rtype.Elem()
	}
	if rtype.Kind() == reflect.Map {
		rtype = rtype.Elem()
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
	if rtype.Kind() != reflect.Struct {
		return
	}
	tsType, subTypes := generateTSTypeInternal(rtype, tsTypesMap)
	tsTypesMap[rtype] = tsType
	for _, subType := range subTypes {
		GenerateTSType(subType, tsTypesMap)
	}
}

func hasUpdatesReturn(method reflect.Method) bool {
	for idx := 0; idx < method.Type.NumOut(); idx++ {
		outType := method.Type.Out(idx)
		if outType == updatesRtnRType {
			return true
		}
	}
	return false
}

func GenerateMethodSignature(serviceName string, method reflect.Method, meta tsgenmeta.MethodMeta, isFirst bool, tsTypesMap map[reflect.Type]string) string {
	var sb strings.Builder
	mayReturnUpdates := hasUpdatesReturn(method)
	if (meta.Desc != "" || meta.ReturnDesc != "" || mayReturnUpdates) && !isFirst {
		sb.WriteString("\n")
	}
	if meta.Desc != "" {
		sb.WriteString(fmt.Sprintf("    // %s\n", meta.Desc))
	}
	if mayReturnUpdates || meta.ReturnDesc != "" {
		if mayReturnUpdates && meta.ReturnDesc != "" {
			sb.WriteString(fmt.Sprintf("    // @returns %s (and object updates)\n", meta.ReturnDesc))
		} else if mayReturnUpdates {
			sb.WriteString("    // @returns object updates\n")
		} else {
			sb.WriteString(fmt.Sprintf("    // @returns %s\n", meta.ReturnDesc))
		}
	}
	sb.WriteString("    ")
	sb.WriteString(method.Name)
	sb.WriteString("(")
	wroteArg := false
	// skip first arg, which is the receiver
	for idx := 1; idx < method.Type.NumIn(); idx++ {
		if wroteArg {
			sb.WriteString(", ")
		}
		inType := method.Type.In(idx)
		if inType == contextRType || inType == uiContextRType {
			continue
		}
		tsTypeName, _ := TypeToTSType(inType, tsTypesMap)
		var argName string
		if idx-1 < len(meta.ArgNames) {
			argName = meta.ArgNames[idx-1] // subtract 1 for receiver
		} else {
			argName = fmt.Sprintf("arg%d", idx)
		}
		sb.WriteString(fmt.Sprintf("%s: %s", argName, tsTypeName))
		wroteArg = true
	}
	sb.WriteString("): ")
	wroteRtn := false
	for idx := 0; idx < method.Type.NumOut(); idx++ {
		outType := method.Type.Out(idx)
		if outType == errorRType {
			continue
		}
		if outType == updatesRtnRType {
			continue
		}
		tsTypeName, _ := TypeToTSType(outType, tsTypesMap)
		sb.WriteString(fmt.Sprintf("Promise<%s>", tsTypeName))
		wroteRtn = true
	}
	if !wroteRtn {
		sb.WriteString("Promise<void>")
	}
	sb.WriteString(" {\n")
	return sb.String()
}

func GenerateMethodBody(serviceName string, method reflect.Method, meta tsgenmeta.MethodMeta) string {
	return fmt.Sprintf("        return WOS.callBackendService(%q, %q, Array.from(arguments))\n", serviceName, method.Name)
}

func GenerateServiceClass(serviceName string, serviceObj any, tsTypesMap map[reflect.Type]string) string {
	serviceType := reflect.TypeOf(serviceObj)
	var sb strings.Builder
	tsServiceName := serviceType.Elem().Name()
	sb.WriteString(fmt.Sprintf("// %s (%s)\n", serviceType.Elem().String(), serviceName))
	sb.WriteString("class ")
	sb.WriteString(tsServiceName + "Type")
	sb.WriteString(" {\n")
	isFirst := true
	for midx := 0; midx < serviceType.NumMethod(); midx++ {
		method := serviceType.Method(midx)
		if strings.HasSuffix(method.Name, "_Meta") {
			continue
		}
		var meta tsgenmeta.MethodMeta
		metaMethod, found := serviceType.MethodByName(method.Name + "_Meta")
		if found {
			serviceObjVal := reflect.ValueOf(serviceObj)
			metaVal := metaMethod.Func.Call([]reflect.Value{serviceObjVal})
			meta = metaVal[0].Interface().(tsgenmeta.MethodMeta)
		}
		sb.WriteString(GenerateMethodSignature(serviceName, method, meta, isFirst, tsTypesMap))
		sb.WriteString(GenerateMethodBody(serviceName, method, meta))
		sb.WriteString("    }\n")
		isFirst = false
	}
	sb.WriteString("}\n\n")
	sb.WriteString(fmt.Sprintf("export const %s = new %sType()\n", tsServiceName, tsServiceName))
	return sb.String()
}

func GenerateWaveObjTypes(tsTypesMap map[reflect.Type]string) {
	GenerateTSTypeUnion(blockcontroller.CommandTypeUnionMeta(), tsTypesMap)
	GenerateTSType(reflect.TypeOf(waveobj.ORef{}), tsTypesMap)
	GenerateTSType(reflect.TypeOf((*waveobj.WaveObj)(nil)).Elem(), tsTypesMap)
	GenerateTSType(reflect.TypeOf(map[string]any{}), tsTypesMap)
	GenerateTSType(reflect.TypeOf(service.WebCallType{}), tsTypesMap)
	GenerateTSType(reflect.TypeOf(service.WebReturnType{}), tsTypesMap)
	GenerateTSType(reflect.TypeOf(wstore.UIContext{}), tsTypesMap)
	GenerateTSType(reflect.TypeOf(eventbus.WSEventType{}), tsTypesMap)
	for _, rtype := range wstore.AllWaveObjTypes() {
		GenerateTSType(rtype, tsTypesMap)
	}
}

func GenerateServiceTypes(tsTypesMap map[reflect.Type]string) error {
	for _, serviceObj := range service.ServiceMap {
		serviceType := reflect.TypeOf(serviceObj)
		for midx := 0; midx < serviceType.NumMethod(); midx++ {
			method := serviceType.Method(midx)
			err := generateTSMethodTypes(method, tsTypesMap)
			if err != nil {
				return fmt.Errorf("error generating TS method types for %s.%s: %v", serviceType, method.Name, err)
			}
		}
	}
	return nil
}
