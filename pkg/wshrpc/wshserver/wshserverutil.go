// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"reflect"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
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
	rtn := &WshServerMethodDecl{
		Command:                 command,
		CommandType:             commandType,
		MethodName:              methodName,
		Method:                  methodVal,
		CommandDataType:         methodType.In(1),
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
	methodDecl := WshServerCommandToDeclMap[command]
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
	if methodDecl.CommandType == wshutil.RpcType_Call {
		rtnVals := methodDecl.Method.Call(callParams)
		rtnData, rtnErr := decodeRtnVals(rtnVals)
		if rtnErr != nil {
			handler.SendResponseError(rtnErr)
			return true
		}
		handler.SendResponse(rtnData, true)
		return true
	} else if methodDecl.CommandType == wshutil.RpcType_ResponseStream {
		rtnVals := methodDecl.Method.Call(callParams)
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

func MakeUnixListener(sockName string) (net.Listener, error) {
	os.Remove(sockName) // ignore error
	rtn, err := net.Listen("unix", sockName)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", sockName, err)
	}
	os.Chmod(sockName, 0700)
	log.Printf("Server listening on %s\n", sockName)
	return rtn, nil
}

func runWshRpcWithStream(conn net.Conn) {
	defer conn.Close()
	inputCh := make(chan []byte, DefaultInputChSize)
	outputCh := make(chan []byte, DefaultOutputChSize)
	go wshutil.AdaptMsgChToStream(outputCh, conn)
	go wshutil.AdaptStreamToMsgCh(conn, inputCh)
	wshutil.MakeWshRpc(inputCh, outputCh, wshutil.RpcContext{}, mainWshServerHandler)
}

func RunWshRpcOverListener(listener net.Listener) {
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				log.Printf("error accepting connection: %v\n", err)
				continue
			}
			go runWshRpcWithStream(conn)
		}
	}()
}

func MakeClientJWTToken(rpcCtx wshutil.RpcContext, sockName string) (string, error) {
	claims := jwt.MapClaims{}
	claims["iat"] = time.Now().Unix()
	claims["iss"] = "waveterm"
	claims["sock"] = sockName
	claims["exp"] = time.Now().Add(time.Hour * 24 * 365).Unix()
	if rpcCtx.BlockId != "" {
		claims["blockid"] = rpcCtx.BlockId
	}
	if rpcCtx.TabId != "" {
		claims["tabid"] = rpcCtx.TabId
	}
	if rpcCtx.WindowId != "" {
		claims["windowid"] = rpcCtx.WindowId
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(wavebase.JwtSecret))
	if err != nil {
		return "", fmt.Errorf("error signing token: %w", err)
	}
	return tokenStr, nil
}

func ValidateAndExtractRpcContextFromToken(tokenStr string) (wshutil.RpcContext, error) {
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Name}))
	token, err := parser.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		return []byte(wavebase.JwtSecret), nil
	})
	if err != nil {
		return wshutil.RpcContext{}, fmt.Errorf("error parsing token: %w", err)
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return wshutil.RpcContext{}, fmt.Errorf("error getting claims from token")
	}
	// validate "exp" claim
	if exp, ok := claims["exp"].(float64); ok {
		if int64(exp) < time.Now().Unix() {
			return wshutil.RpcContext{}, fmt.Errorf("token has expired")
		}
	} else {
		return wshutil.RpcContext{}, fmt.Errorf("exp claim is missing or invalid")
	}
	// validate "iss" claim
	if iss, ok := claims["iss"].(string); ok {
		if iss != "waveterm" {
			return wshutil.RpcContext{}, fmt.Errorf("unexpected issuer: %s", iss)
		}
	} else {
		return wshutil.RpcContext{}, fmt.Errorf("iss claim is missing or invalid")
	}
	rpcCtx := wshutil.RpcContext{}
	rpcCtx.BlockId = claims["blockid"].(string)
	rpcCtx.TabId = claims["tabid"].(string)
	rpcCtx.WindowId = claims["windowid"].(string)
	return rpcCtx, nil
}

func ExtractUnverifiedSocketName(tokenStr string) (string, error) {
	// this happens on the client who does not have access to the secret key
	// we want to read the claims without validating the signature
	token, _, err := new(jwt.Parser).ParseUnverified(tokenStr, jwt.MapClaims{})
	if err != nil {
		return "", fmt.Errorf("error parsing token: %w", err)
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("error getting claims from token")
	}
	sockName, ok := claims["sock"].(string)
	if !ok {
		return "", fmt.Errorf("sock claim is missing or invalid")
	}
	return sockName, nil
}

func RunDomainSocketWshServer() error {
	sockName := wavebase.GetDomainSocketName()
	listener, err := MakeUnixListener(sockName)
	if err != nil {
		return fmt.Errorf("error starging unix listener for wsh-server: %w", err)
	}
	defer listener.Close()
	RunWshRpcOverListener(listener)
	return nil
}

func MakeWshServer(inputCh chan []byte, outputCh chan []byte, initialCtx wshutil.RpcContext) {
	wshutil.MakeWshRpc(inputCh, outputCh, initialCtx, mainWshServerHandler)
}
