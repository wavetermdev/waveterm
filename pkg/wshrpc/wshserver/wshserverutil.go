// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"net"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

// this file contains the generic types and functions that create and power the WSH server

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

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
		go wshutil.SetupConnRpcClient(conn, &WshServerImpl)
	}
}

func MakeWshServer(inputCh chan []byte, outputCh chan []byte, initialCtx wshrpc.RpcContext) {
	wshutil.MakeWshRpc(inputCh, outputCh, initialCtx, &WshServerImpl)
}
