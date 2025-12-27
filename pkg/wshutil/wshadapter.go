// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

func recodeCommandData(command string, data any, rpcCtx *wshrpc.RpcContext) (any, error) {
	// only applies to initial command packet
	if command == "" {
		return data, nil
	}
	methodDecl := WshCommandDeclMap[command]
	if methodDecl == nil {
		return data, fmt.Errorf("command %q not found", command)
	}
	if methodDecl.CommandDataType == nil {
		return data, nil
	}
	commandDataPtr := reflect.New(methodDecl.CommandDataType).Interface()
	if data != nil {
		err := utilfn.ReUnmarshal(commandDataPtr, data)
		if err != nil {
			return data, fmt.Errorf("error re-marshalling command data: %w", err)
		}
	}
	return reflect.ValueOf(commandDataPtr).Elem().Interface(), nil
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
			if !handler.NeedsResponse() && cmd != wshrpc.Command_Message {
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
			rpcCtx := handler.GetRpcContext()
			cmdData, err := recodeCommandData(cmd, handler.GetCommandRawData(), &rpcCtx)
			if err != nil {
				handler.SendResponseError(err)
				return true
			}
			callParams = append(callParams, reflect.ValueOf(cmdData))
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
				defer func() {
					panichandler.PanicHandler("serverImplAdapter:responseStream", recover())
				}()
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
