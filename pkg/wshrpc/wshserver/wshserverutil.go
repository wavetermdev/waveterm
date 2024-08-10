// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"net"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

// this file contains the generic types and functions that create and power the WSH server

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

type WshServer struct{}

type WshServerMethodDecl struct {
	Command                 string
	CommandType             string
	MethodName              string
	Method                  reflect.Value
	CommandDataType         reflect.Type
	DefaultResponseDataType reflect.Type
	RequestDataTypes        []reflect.Type // for streaming requests
	ResponseDataTypes       []reflect.Type // for streaming responses
}

var WshServerImpl = WshServer{}
var contextRType = reflect.TypeOf((*context.Context)(nil)).Elem()
var wshCommandDeclMap = wshrpc.GenerateWshCommandDeclMap()

func GetWshServerMethod(command string, commandType string, methodName string, methodFunc any) *WshServerMethodDecl {
	methodVal := reflect.ValueOf(methodFunc)
	methodType := methodVal.Type()
	if methodType.Kind() != reflect.Func {
		panic(fmt.Sprintf("methodVal must be a function got [%v]", methodType))
	}
	if methodType.In(0) != contextRType {
		panic(fmt.Sprintf("methodVal must have a context as the first argument %v", methodType))
	}
	var defResponseType reflect.Type
	if methodType.NumOut() > 1 {
		defResponseType = methodType.Out(0)
	}
	var cdataType reflect.Type
	if methodType.NumIn() > 1 {
		cdataType = methodType.In(1)
	}
	rtn := &WshServerMethodDecl{
		Command:                 command,
		CommandType:             commandType,
		MethodName:              methodName,
		Method:                  methodVal,
		CommandDataType:         cdataType,
		DefaultResponseDataType: defResponseType,
	}
	return rtn
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

func mainWshServerHandler(handler *wshutil.RpcResponseHandler) bool {
	command := handler.GetCommand()
	methodDecl := wshCommandDeclMap[command]
	if methodDecl == nil {
		handler.SendResponseError(fmt.Errorf("command %q not found", command))
		return true
	}
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
	implVal := reflect.ValueOf(&WshServerImpl)
	implMethod := implVal.MethodByName(methodDecl.MethodName)
	if !implMethod.IsValid() {
		if !handler.NeedsResponse() {
			// we also send an out of band message here since this is likely unexpected and will require debugging
			handler.SendMessage(fmt.Sprintf("command %q method %q not found", handler.GetCommand(), methodDecl.MethodName))
		}
		handler.SendResponseError(fmt.Errorf("method %q not found", methodDecl.MethodName))
		return true
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

func RunWshRpcOverListener(listener net.Listener) {
	defer log.Printf("domain socket listener shutting down\n")
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("error accepting connection: %v\n", err)
			continue
		}
		log.Print("got domain socket connection\n")
		// TODO deal with closing connection
		go wshutil.SetupConnRpcClient(conn, mainWshServerHandler)
	}
}

func MakeWshServer(inputCh chan []byte, outputCh chan []byte, initialCtx wshrpc.RpcContext) {
	wshutil.MakeWshRpc(inputCh, outputCh, initialCtx, mainWshServerHandler)
}
