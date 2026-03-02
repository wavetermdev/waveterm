// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgen

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestGenerateWshClientApiMethodCall_MultiArg(t *testing.T) {
	methodDecl := &wshrpc.WshRpcMethodDecl{
		Command:          "test",
		CommandType:      wshrpc.RpcType_Call,
		MethodName:       "TestCommand",
		CommandDataTypes: []reflect.Type{reflect.TypeOf(""), reflect.TypeOf(0)},
	}
	out := GenerateWshClientApiMethod(methodDecl, map[reflect.Type]string{})
	if !strings.Contains(out, "TestCommand(client: WshClient, arg1: string, arg2: number, opts?: RpcOpts): Promise<void> {") {
		t.Fatalf("generated method missing multi-arg signature:\n%s", out)
	}
	if !strings.Contains(out, "return client.wshRpcCall(\"test\", { args: [arg1, arg2] }, opts);") {
		t.Fatalf("generated method missing MultiArg payload:\n%s", out)
	}
}
