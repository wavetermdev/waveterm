// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gogen

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func GenerateBoilerplate(buf *strings.Builder, pkgName string, imports []string) {
	buf.WriteString("// Copyright 2026, Command Line Inc.\n")
	buf.WriteString("// SPDX-License-Identifier: Apache-2.0\n")
	buf.WriteString("\n// Generated Code. DO NOT EDIT.\n\n")
	buf.WriteString(fmt.Sprintf("package %s\n\n", pkgName))
	if len(imports) > 0 {
		buf.WriteString("import (\n")
		for _, imp := range imports {
			buf.WriteString(fmt.Sprintf("\t%q\n", imp))
		}
		buf.WriteString(")\n\n")
	}
}

func getBeforeColonPart(s string) string {
	if colonIdx := strings.Index(s, ":"); colonIdx != -1 {
		return s[:colonIdx]
	}
	return s
}

func GenerateMetaMapConsts(buf *strings.Builder, constPrefix string, rtype reflect.Type, embedded bool) {
	if !embedded {
		buf.WriteString("const (\n")
	} else {
		buf.WriteString("\n")
	}
	var lastBeforeColon = ""
	isFirst := true
	for idx := 0; idx < rtype.NumField(); idx++ {
		field := rtype.Field(idx)
		if field.PkgPath != "" {
			continue
		}
		if field.Anonymous {
			var embeddedBuf strings.Builder
			GenerateMetaMapConsts(&embeddedBuf, constPrefix, field.Type, true)
			buf.WriteString(embeddedBuf.String())
			continue
		}
		fieldName := field.Name
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag == "" {
			jsonTag = fieldName
		}
		beforeColon := getBeforeColonPart(jsonTag)
		if beforeColon != lastBeforeColon {
			if !isFirst {
				buf.WriteString("\n")
			}
			lastBeforeColon = beforeColon
		}
		cname := constPrefix + fieldName
		buf.WriteString(fmt.Sprintf("\t%-40s = %q\n", cname, jsonTag))
		isFirst = false
	}
	if !embedded {
		buf.WriteString(")\n")
	}
}

func GenMethod_Call(buf *strings.Builder, methodDecl *wshrpc.WshRpcMethodDecl) {
	fmt.Fprintf(buf, "// command %q, wshserver.%s\n", methodDecl.Command, methodDecl.MethodName)
	var dataType string
	dataVarName := "nil"
	if methodDecl.CommandDataType != nil {
		dataType = ", data " + methodDecl.CommandDataType.String()
		dataVarName = "data"
	}
	returnType := "error"
	respName := "_"
	tParamVal := "any"
	if methodDecl.DefaultResponseDataType != nil {
		returnType = "(" + methodDecl.DefaultResponseDataType.String() + ", error)"
		respName = "resp"
		tParamVal = methodDecl.DefaultResponseDataType.String()
	}
	fmt.Fprintf(buf, "func %s(w *wshutil.WshRpc%s, opts *wshrpc.RpcOpts) %s {\n", methodDecl.MethodName, dataType, returnType)
	fmt.Fprintf(buf, "\t%s, err := sendRpcRequestCallHelper[%s](w, %q, %s, opts)\n", respName, tParamVal, methodDecl.Command, dataVarName)
	if methodDecl.DefaultResponseDataType != nil {
		fmt.Fprintf(buf, "\treturn resp, err\n")
	} else {
		fmt.Fprintf(buf, "\treturn err\n")
	}
	fmt.Fprintf(buf, "}\n\n")
}

func GenMethod_ResponseStream(buf *strings.Builder, methodDecl *wshrpc.WshRpcMethodDecl) {
	fmt.Fprintf(buf, "// command %q, wshserver.%s\n", methodDecl.Command, methodDecl.MethodName)
	var dataType string
	dataVarName := "nil"
	if methodDecl.CommandDataType != nil {
		dataType = ", data " + methodDecl.CommandDataType.String()
		dataVarName = "data"
	}
	respType := "any"
	if methodDecl.DefaultResponseDataType != nil {
		respType = methodDecl.DefaultResponseDataType.String()
	}
	fmt.Fprintf(buf, "func %s(w *wshutil.WshRpc%s, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[%s] {\n", methodDecl.MethodName, dataType, respType)
	fmt.Fprintf(buf, "\treturn sendRpcRequestResponseStreamHelper[%s](w, %q, %s, opts)\n", respType, methodDecl.Command, dataVarName)
	fmt.Fprintf(buf, "}\n\n")
}
