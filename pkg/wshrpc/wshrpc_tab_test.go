// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"reflect"
	"testing"
)

func TestCreateTabCommandRegistered(t *testing.T) {
	decl := GenerateWshCommandDeclMap()["createtab"]
	if decl == nil {
		t.Fatalf("expected createtab command declaration")
	}
	if decl.MethodName != "CreateTabCommand" {
		t.Fatalf("expected CreateTabCommand method name, got %q", decl.MethodName)
	}
	dataTypes := decl.GetCommandDataTypes()
	if len(dataTypes) != 1 {
		t.Fatalf("expected 1 command arg, got %d", len(dataTypes))
	}
	if dataTypes[0] != reflect.TypeOf(CommandCreateTabData{}) {
		t.Fatalf("expected CommandCreateTabData arg, got %v", dataTypes[0])
	}
	if decl.DefaultResponseDataType == nil || decl.DefaultResponseDataType.Kind() != reflect.String {
		t.Fatalf("expected createtab to return a string, got %v", decl.DefaultResponseDataType)
	}
}

func TestFocusTabCommandRegistered(t *testing.T) {
	decl := GenerateWshCommandDeclMap()["focustab"]
	if decl == nil {
		t.Fatalf("expected focustab command declaration")
	}
	if decl.MethodName != "FocusTabCommand" {
		t.Fatalf("expected FocusTabCommand method name, got %q", decl.MethodName)
	}
	dataTypes := decl.GetCommandDataTypes()
	if len(dataTypes) != 1 {
		t.Fatalf("expected 1 command arg, got %d", len(dataTypes))
	}
	if dataTypes[0].Kind() != reflect.String {
		t.Fatalf("expected focustab arg to be string, got %v", dataTypes[0])
	}
}

func TestUpdateTabNameCommandRegistered(t *testing.T) {
	decl := GenerateWshCommandDeclMap()["updatetabname"]
	if decl == nil {
		t.Fatalf("expected updatetabname command declaration")
	}
	dataTypes := decl.GetCommandDataTypes()
	if len(dataTypes) != 2 {
		t.Fatalf("expected 2 command args, got %d", len(dataTypes))
	}
	for i, dt := range dataTypes {
		if dt.Kind() != reflect.String {
			t.Fatalf("expected updatetabname arg %d to be string, got %v", i, dt)
		}
	}
}

func TestCommandCreateTabDataJSONTags(t *testing.T) {
	rtype := reflect.TypeOf(CommandCreateTabData{})
	expected := map[string]string{
		"WorkspaceId": "workspaceid,omitempty",
		"TabName":     "tabname,omitempty",
		"ActivateTab": "activatetab,omitempty",
	}
	for fieldName, want := range expected {
		field, ok := rtype.FieldByName(fieldName)
		if !ok {
			t.Fatalf("field %s not found on CommandCreateTabData", fieldName)
		}
		got := field.Tag.Get("json")
		if got != want {
			t.Fatalf("field %s json tag = %q, want %q", fieldName, got, want)
		}
	}
}
