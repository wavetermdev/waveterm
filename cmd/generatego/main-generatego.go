// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"
	"reflect"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/gogen"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const WshClientFileName = "pkg/wshrpc/wshclient/wshclient.go"
const WaveObjMetaConstsFileName = "pkg/waveobj/metaconsts.go"
const SettingsMetaConstsFileName = "pkg/wconfig/metaconsts.go"

func GenerateWshClient() {
	fmt.Fprintf(os.Stderr, "generating wshclient file to %s\n", WshClientFileName)
	var buf strings.Builder
	gogen.GenerateBoilerplate(&buf, "wshclient", []string{
		"github.com/wavetermdev/waveterm/pkg/wshutil",
		"github.com/wavetermdev/waveterm/pkg/wshrpc",
		"github.com/wavetermdev/waveterm/pkg/waveobj",
		"github.com/wavetermdev/waveterm/pkg/wconfig",
	})
	wshDeclMap := wshrpc.GenerateWshCommandDeclMap()
	for _, key := range utilfn.GetOrderedMapKeys(wshDeclMap) {
		methodDecl := wshDeclMap[key]
		if methodDecl.CommandType == wshrpc.RpcType_ResponseStream {
			gogen.GenMethod_ResponseStream(&buf, methodDecl)
		} else if methodDecl.CommandType == wshrpc.RpcType_Call {
			gogen.GenMethod_Call(&buf, methodDecl)
		} else {
			panic("unsupported command type " + methodDecl.CommandType)
		}
	}
	buf.WriteString("\n")
	err := os.WriteFile(WshClientFileName, []byte(buf.String()), 0644)
	if err != nil {
		panic(err)
	}
}

func GenerateWaveObjMetaConsts() {
	fmt.Fprintf(os.Stderr, "generating waveobj meta consts file to %s\n", WaveObjMetaConstsFileName)
	var buf strings.Builder
	gogen.GenerateBoilerplate(&buf, "waveobj", []string{})
	gogen.GenerateMetaMapConsts(&buf, "MetaKey_", reflect.TypeOf(waveobj.MetaTSType{}))
	buf.WriteString("\n")
	err := os.WriteFile(WaveObjMetaConstsFileName, []byte(buf.String()), 0644)
	if err != nil {
		panic(err)
	}
}

func GenerateSettingsMetaConsts() {
	fmt.Fprintf(os.Stderr, "generating settings meta consts file to %s\n", SettingsMetaConstsFileName)
	var buf strings.Builder
	gogen.GenerateBoilerplate(&buf, "wconfig", []string{})
	gogen.GenerateMetaMapConsts(&buf, "ConfigKey_", reflect.TypeOf(wconfig.SettingsType{}))
	buf.WriteString("\n")
	err := os.WriteFile(SettingsMetaConstsFileName, []byte(buf.String()), 0644)
	if err != nil {
		panic(err)
	}
}

func main() {
	GenerateWshClient()
	GenerateWaveObjMetaConsts()
	GenerateSettingsMetaConsts()
}
