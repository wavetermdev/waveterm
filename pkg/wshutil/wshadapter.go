// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

var WshCommandDeclMap = wshrpc.GenerateWshCommandDeclMap()

func findCmdMethod(impl any, cmd string) *reflect.Method {
	rtype := reflect.TypeOf(impl)
	methodName := cmd + "command"
	for i := 0; i < rtype.NumMethod(); i++ {
		method := rtype.Method(i)
		if strings.ToLower(method.Name) == methodName {
			return &method
		}
	}
	return nil
}

func decodeRtnVals(rtnVals []reflect.Value) (any, error) {
	switch len(rtnVals) {
	case 0:
		return nil, nil
	case 1:
		errIf := rtnVals[0].Interface()
		if errIf == nil {
			return nil, nil
		}
		return nil, errIf.(error)
	case 2:
		errIf := rtnVals[1].Interface()
		if errIf == nil {
			return rtnVals[0].Interface(), nil
		}
		return rtnVals[0].Interface(), errIf.(error)
	default:
		return nil, fmt.Errorf("too many return values: %d", len(rtnVals))
	}
}

func noImplHandler(handler *RpcResponseHandler) bool {
	handler.SendResponseError(fmt.Errorf("command %q not implemented", handler.GetCommand()))
	return true
}

func serverImplAdapter(impl any) func(*RpcResponseHandler) bool {
	if impl == nil {
		return noImplHandler
	}
	rtype := reflect.TypeOf(impl)
	if rtype.Kind() != reflect.Ptr && rtype.Elem().Kind() != reflect.Struct {
		panic(fmt.Sprintf("expected struct pointer, got %s", rtype))
	}
	// returns isAsync
	return func(handler *RpcResponseHandler) bool {
		cmd := handler.GetCommand()
		methodDecl := WshCommandDeclMap[cmd]
		if methodDecl == nil {
			handler.SendResponseError(fmt.Errorf("command %q not found", cmd))
			return true
		}
		rmethod := findCmdMethod(impl, cmd)
		if rmethod == nil {
			if !handler.NeedsResponse() {
				// we also send an out of band message here since this is likely unexpected and will require debugging
				handler.SendMessage(fmt.Sprintf("command %q method %q not found", handler.GetCommand(), methodDecl.MethodName))
			}
			handler.SendResponseError(fmt.Errorf("command not implemented %q", cmd))
			return true
		}
		implMethod := reflect.ValueOf(impl).MethodByName(rmethod.Name)
		var callParams []reflect.Value
		callParams = append(callParams, reflect.ValueOf(handler.Context()))
		if methodDecl.CommandDataType != nil {
			commandData := reflect.New(methodDecl.CommandDataType).Interface()
			err := utilfn.ReUnmarshal(commandData, handler.GetCommandRawData())
			if err != nil {
				handler.SendResponseError(fmt.Errorf("error re-marshalling command data: %w", err))
				return true
			}
			wshrpc.HackRpcContextIntoData(commandData, handler.GetRpcContext())
			callParams = append(callParams, reflect.ValueOf(commandData).Elem())
		}
		if methodDecl.CommandType == wshrpc.RpcType_Call {
			rtnVals := implMethod.Call(callParams)
			rtnData, rtnErr := decodeRtnVals(rtnVals)
			if rtnErr != nil {
				handler.SendResponseError(rtnErr)
				return true
			}
			handler.SendResponse(rtnData, true)
			return true
		} else if methodDecl.CommandType == wshrpc.RpcType_ResponseStream {
			rtnVals := implMethod.Call(callParams)
			rtnChVal := rtnVals[0]
			if rtnChVal.IsNil() {
				handler.SendResponse(nil, true)
				return true
			}
			go func() {
				defer handler.Finalize()
				// must use reflection here because we don't know the generic type of RespOrErrorUnion
				for {
					respVal, ok := rtnChVal.Recv()
					if !ok {
						break
					}
					errorVal := respVal.FieldByName("Error")
					if !errorVal.IsNil() {
						handler.SendResponseError(errorVal.Interface().(error))
						break
					}
					respData := respVal.FieldByName("Response").Interface()
					handler.SendResponse(respData, false)
				}
			}()
			return false
		} else {
			handler.SendResponseError(fmt.Errorf("unsupported command type %q", methodDecl.CommandType))
			return true
		}
	}
}
