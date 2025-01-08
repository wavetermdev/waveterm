// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package service

import (
	"context"
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/service/blockservice"
	"github.com/wavetermdev/waveterm/pkg/service/clientservice"
	"github.com/wavetermdev/waveterm/pkg/service/fileservice"
	"github.com/wavetermdev/waveterm/pkg/service/objectservice"
	"github.com/wavetermdev/waveterm/pkg/service/userinputservice"
	"github.com/wavetermdev/waveterm/pkg/service/windowservice"
	"github.com/wavetermdev/waveterm/pkg/service/workspaceservice"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/web/webcmd"
)

var ServiceMap = map[string]any{
	"block":     blockservice.BlockServiceInstance,
	"object":    &objectservice.ObjectService{},
	"file":      &fileservice.FileService{},
	"client":    &clientservice.ClientService{},
	"window":    &windowservice.WindowService{},
	"workspace": &workspaceservice.WorkspaceService{},
	"userinput": &userinputservice.UserInputService{},
}

var contextRType = reflect.TypeOf((*context.Context)(nil)).Elem()
var errorRType = reflect.TypeOf((*error)(nil)).Elem()
var updatesRType = reflect.TypeOf(([]waveobj.WaveObjUpdate{}))
var waveObjRType = reflect.TypeOf((*waveobj.WaveObj)(nil)).Elem()
var waveObjSliceRType = reflect.TypeOf([]waveobj.WaveObj{})
var waveObjMapRType = reflect.TypeOf(map[string]waveobj.WaveObj{})
var methodMetaRType = reflect.TypeOf(tsgenmeta.MethodMeta{})
var waveObjUpdateRType = reflect.TypeOf(waveobj.WaveObjUpdate{})
var uiContextRType = reflect.TypeOf((*waveobj.UIContext)(nil)).Elem()
var wsCommandRType = reflect.TypeOf((*webcmd.WSCommandType)(nil)).Elem()
var orefRType = reflect.TypeOf((*waveobj.ORef)(nil)).Elem()

type WebCallType struct {
	Service   string             `json:"service"`
	Method    string             `json:"method"`
	UIContext *waveobj.UIContext `json:"uicontext,omitempty"`
	Args      []any              `json:"args"`
}

type WebReturnType struct {
	Success bool                    `json:"success,omitempty"`
	Error   string                  `json:"error,omitempty"`
	Data    any                     `json:"data,omitempty"`
	Updates []waveobj.WaveObjUpdate `json:"updates,omitempty"`
}

func convertNumber(argType reflect.Type, jsonArg float64) (any, error) {
	switch argType.Kind() {
	case reflect.Int:
		return int(jsonArg), nil
	case reflect.Int8:
		return int8(jsonArg), nil
	case reflect.Int16:
		return int16(jsonArg), nil
	case reflect.Int32:
		return int32(jsonArg), nil
	case reflect.Int64:
		return int64(jsonArg), nil
	case reflect.Uint:
		return uint(jsonArg), nil
	case reflect.Uint8:
		return uint8(jsonArg), nil
	case reflect.Uint16:
		return uint16(jsonArg), nil
	case reflect.Uint32:
		return uint32(jsonArg), nil
	case reflect.Uint64:
		return uint64(jsonArg), nil
	case reflect.Float32:
		return float32(jsonArg), nil
	case reflect.Float64:
		return jsonArg, nil
	}
	return nil, fmt.Errorf("invalid number type %s", argType)
}

func convertComplex(argType reflect.Type, jsonArg any) (any, error) {
	nativeArgVal := reflect.New(argType)
	err := utilfn.DoMapStructure(nativeArgVal.Interface(), jsonArg)
	if err != nil {
		return nil, err
	}
	return nativeArgVal.Elem().Interface(), nil
}

func isSpecialWaveArgType(argType reflect.Type) bool {
	return argType == waveObjRType || argType == waveObjSliceRType || argType == waveObjMapRType || argType == wsCommandRType
}

func convertWSCommand(argType reflect.Type, jsonArg any) (any, error) {
	if _, ok := jsonArg.(map[string]any); !ok {
		return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
	}
	cmd, err := webcmd.ParseWSCommandMap(jsonArg.(map[string]any))
	if err != nil {
		return nil, fmt.Errorf("error parsing command map: %w", err)
	}
	return cmd, nil
}

func convertSpecial(argType reflect.Type, jsonArg any) (any, error) {
	jsonType := reflect.TypeOf(jsonArg)
	if argType == orefRType {
		if jsonType.Kind() != reflect.String {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		oref, err := waveobj.ParseORef(jsonArg.(string))
		if err != nil {
			return nil, fmt.Errorf("invalid oref string: %v", err)
		}
		return oref, nil
	} else if argType == wsCommandRType {
		return convertWSCommand(argType, jsonArg)
	} else if argType == waveObjRType {
		if jsonType.Kind() != reflect.Map {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		return waveobj.FromJsonMap(jsonArg.(map[string]any))
	} else if argType == waveObjSliceRType {
		if jsonType.Kind() != reflect.Slice {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		sliceArg := jsonArg.([]any)
		nativeSlice := make([]waveobj.WaveObj, len(sliceArg))
		for idx, elem := range sliceArg {
			elemMap, ok := elem.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("cannot convert %T to %s (idx %d is not a map, is %T)", jsonArg, waveObjSliceRType, idx, elem)
			}
			nativeObj, err := waveobj.FromJsonMap(elemMap)
			if err != nil {
				return nil, fmt.Errorf("cannot convert %T to %s (idx %d) error: %v", jsonArg, waveObjSliceRType, idx, err)
			}
			nativeSlice[idx] = nativeObj
		}
		return nativeSlice, nil
	} else if argType == waveObjMapRType {
		if jsonType.Kind() != reflect.Map {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		mapArg := jsonArg.(map[string]any)
		nativeMap := make(map[string]waveobj.WaveObj)
		for key, elem := range mapArg {
			elemMap, ok := elem.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("cannot convert %T to %s (key %s is not a map, is %T)", jsonArg, waveObjMapRType, key, elem)
			}
			nativeObj, err := waveobj.FromJsonMap(elemMap)
			if err != nil {
				return nil, fmt.Errorf("cannot convert %T to %s (key %s) error: %v", jsonArg, waveObjMapRType, key, err)
			}
			nativeMap[key] = nativeObj
		}
		return nativeMap, nil
	} else {
		return nil, fmt.Errorf("invalid special wave argument type %s", argType)
	}
}

func convertSpecialForReturn(argType reflect.Type, nativeArg any) (any, error) {
	if argType == waveObjRType {
		return waveobj.ToJsonMap(nativeArg.(waveobj.WaveObj))
	} else if argType == waveObjSliceRType {
		nativeSlice := nativeArg.([]waveobj.WaveObj)
		jsonSlice := make([]map[string]any, len(nativeSlice))
		for idx, elem := range nativeSlice {
			elemMap, err := waveobj.ToJsonMap(elem)
			if err != nil {
				return nil, err
			}
			jsonSlice[idx] = elemMap
		}
		return jsonSlice, nil
	} else if argType == waveObjMapRType {
		nativeMap := nativeArg.(map[string]waveobj.WaveObj)
		jsonMap := make(map[string]map[string]any)
		for key, elem := range nativeMap {
			elemMap, err := waveobj.ToJsonMap(elem)
			if err != nil {
				return nil, err
			}
			jsonMap[key] = elemMap
		}
		return jsonMap, nil
	} else {
		return nil, fmt.Errorf("invalid special wave argument type %s", argType)
	}
}

func convertArgument(argType reflect.Type, jsonArg any) (any, error) {
	if jsonArg == nil {
		return reflect.Zero(argType).Interface(), nil
	}
	if isSpecialWaveArgType(argType) {
		return convertSpecial(argType, jsonArg)
	}
	jsonType := reflect.TypeOf(jsonArg)
	switch argType.Kind() {
	case reflect.String:
		if jsonType.Kind() == reflect.String {
			return jsonArg, nil
		}
		return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)

	case reflect.Bool:
		if jsonType.Kind() == reflect.Bool {
			return jsonArg, nil
		}
		return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		if jsonType.Kind() == reflect.Float64 {
			return convertNumber(argType, jsonArg.(float64))
		}
		return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)

	case reflect.Map:
		if argType.Key().Kind() != reflect.String {
			return nil, fmt.Errorf("invalid map key type %s", argType.Key())
		}
		if jsonType.Kind() != reflect.Map {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		return convertComplex(argType, jsonArg)

	case reflect.Slice:
		if jsonType.Kind() != reflect.Slice {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		return convertComplex(argType, jsonArg)

	case reflect.Struct:
		if jsonType.Kind() != reflect.Map {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		return convertComplex(argType, jsonArg)

	case reflect.Ptr:
		if argType.Elem().Kind() != reflect.Struct {
			return nil, fmt.Errorf("invalid pointer type %s", argType)
		}
		if jsonType.Kind() != reflect.Map {
			return nil, fmt.Errorf("cannot convert %T to %s", jsonArg, argType)
		}
		return convertComplex(argType, jsonArg)

	default:
		return nil, fmt.Errorf("invalid argument type %s", argType)
	}
}

func isNilable(val reflect.Value) bool {
	switch val.Kind() {
	case reflect.Ptr, reflect.Slice, reflect.Map, reflect.Interface, reflect.Chan, reflect.Func:
		return true
	}
	return false

}

func convertReturnValues(rtnVals []reflect.Value) *WebReturnType {
	rtn := &WebReturnType{}
	if len(rtnVals) == 0 {
		return rtn
	}
	for _, val := range rtnVals {
		if isNilable(val) && val.IsNil() {
			continue
		}
		valType := val.Type()
		if valType == errorRType {
			rtn.Error = val.Interface().(error).Error()
			continue
		}
		if valType == updatesRType {
			// has a special MarshalJSON method
			rtn.Updates = val.Interface().([]waveobj.WaveObjUpdate)
			continue
		}
		if isSpecialWaveArgType(valType) {
			jsonVal, err := convertSpecialForReturn(valType, val.Interface())
			if err != nil {
				rtn.Error = fmt.Errorf("cannot convert special return value: %v", err).Error()
				continue
			}
			rtn.Data = jsonVal
			continue
		}
		rtn.Data = val.Interface()
	}
	if rtn.Error == "" {
		rtn.Success = true
	}
	return rtn
}

func webErrorRtn(err error) *WebReturnType {
	return &WebReturnType{
		Error: err.Error(),
	}
}

func CallService(ctx context.Context, webCall WebCallType) *WebReturnType {
	svcObj := ServiceMap[webCall.Service]
	if svcObj == nil {
		return webErrorRtn(fmt.Errorf("invalid service: %q", webCall.Service))
	}
	method := reflect.ValueOf(svcObj).MethodByName(webCall.Method)
	if !method.IsValid() {
		return webErrorRtn(fmt.Errorf("invalid method: %s.%s", webCall.Service, webCall.Method))
	}
	var valueArgs []reflect.Value
	argIdx := 0
	for idx := 0; idx < method.Type().NumIn(); idx++ {
		argType := method.Type().In(idx)
		if idx == 0 && argType == contextRType {
			valueArgs = append(valueArgs, reflect.ValueOf(ctx))
			continue
		}
		if argType == uiContextRType {
			if webCall.UIContext == nil {
				return webErrorRtn(fmt.Errorf("missing UIContext for %s.%s", webCall.Service, webCall.Method))
			}
			valueArgs = append(valueArgs, reflect.ValueOf(*webCall.UIContext))
			continue
		}
		if argIdx >= len(webCall.Args) {
			return webErrorRtn(fmt.Errorf("not enough arguments passed %s.%s idx:%d (type %T)", webCall.Service, webCall.Method, idx, argType))
		}
		nativeArg, err := convertArgument(argType, webCall.Args[argIdx])
		if err != nil {
			return webErrorRtn(fmt.Errorf("cannot convert argument %s.%s type:%T idx:%d error:%v", webCall.Service, webCall.Method, argType, idx, err))
		}
		valueArgs = append(valueArgs, reflect.ValueOf(nativeArg))
		argIdx++
	}
	retValArr := method.Call(valueArgs)
	return convertReturnValues(retValArr)
}

// ValidateServiceArg validates the argument type for a service method
// does not allow interfaces (and the obvious invalid types)
// arguments + return values have special handling for wave objects
func baseValidateServiceArg(argType reflect.Type) error {
	if argType == waveObjUpdateRType {
		// has special MarshalJSON method, so it is safe
		return nil
	}
	switch argType.Kind() {
	case reflect.Ptr, reflect.Slice, reflect.Array:
		return baseValidateServiceArg(argType.Elem())
	case reflect.Map:
		if argType.Key().Kind() != reflect.String {
			return fmt.Errorf("invalid map key type %s", argType.Key())
		}
		return baseValidateServiceArg(argType.Elem())
	case reflect.Struct:
		for idx := 0; idx < argType.NumField(); idx++ {
			if err := baseValidateServiceArg(argType.Field(idx).Type); err != nil {
				return err
			}
		}
	case reflect.Interface:
		return fmt.Errorf("invalid argument type %s: contains interface", argType)

	case reflect.Chan, reflect.Func, reflect.Complex128, reflect.Complex64, reflect.Invalid, reflect.Uintptr, reflect.UnsafePointer:
		return fmt.Errorf("invalid argument type %s", argType)
	}
	return nil
}

func validateMethodReturnArg(retType reflect.Type) error {
	// specifically allow waveobj.WaveObj, []waveobj.WaveObj, map[string]waveobj.WaveObj, and error
	if isSpecialWaveArgType(retType) || retType == errorRType {
		return nil
	}
	return baseValidateServiceArg(retType)
}

func validateMethodArg(argType reflect.Type) error {
	// specifically allow waveobj.WaveObj, []waveobj.WaveObj, map[string]waveobj.WaveObj, and context.Context
	if isSpecialWaveArgType(argType) || argType == contextRType {
		return nil
	}
	return baseValidateServiceArg(argType)
}

func validateServiceMethod(service string, method reflect.Method) error {
	for idx := 0; idx < method.Type.NumOut(); idx++ {
		if err := validateMethodReturnArg(method.Type.Out(idx)); err != nil {
			return fmt.Errorf("invalid return type %s.%s %s: %v", service, method.Name, method.Type.Out(idx), err)
		}
	}
	for idx := 1; idx < method.Type.NumIn(); idx++ {
		// skip the first argument which is the receiver
		if err := validateMethodArg(method.Type.In(idx)); err != nil {
			return fmt.Errorf("invalid argument type %s.%s %s: %v", service, method.Name, method.Type.In(idx), err)
		}
	}
	return nil
}

func validateServiceMetaMethod(service string, method reflect.Method) error {
	if method.Type.NumIn() != 1 {
		return fmt.Errorf("invalid number of arguments %s.%s: got:%d, expected just the receiver", service, method.Name, method.Type.NumIn())
	}
	if method.Type.NumOut() != 1 && method.Type.Out(0) != methodMetaRType {
		return fmt.Errorf("invalid return type %s.%s: got:%s, expected servicemeta.MethodMeta", service, method.Name, method.Type.Out(0))
	}
	return nil
}

func ValidateService(serviceName string, svcObj any) error {
	svcType := reflect.TypeOf(svcObj)
	if svcType.Kind() != reflect.Ptr {
		return fmt.Errorf("service object %q must be a pointer", serviceName)
	}
	svcType = svcType.Elem()
	if svcType.Kind() != reflect.Struct {
		return fmt.Errorf("service object %q must be a ptr to struct", serviceName)
	}
	for idx := 0; idx < svcType.NumMethod(); idx++ {
		method := svcType.Method(idx)
		if strings.HasSuffix(method.Name, "_Meta") {
			err := validateServiceMetaMethod(serviceName, method)
			if err != nil {
				return err
			}
		}
		if err := validateServiceMethod(serviceName, method); err != nil {
			return err
		}
	}
	return nil
}

func ValidateServiceMap() error {
	for svcName, svcObj := range ServiceMap {
		if err := ValidateService(svcName, svcObj); err != nil {
			return err
		}
	}
	return nil
}
