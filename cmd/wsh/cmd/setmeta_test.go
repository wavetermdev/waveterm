// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"reflect"
	"testing"
)

func TestParseMetaSets(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		want    map[string]any
		wantErr bool
	}{
		{
			name:  "basic types",
			input: []string{"str=hello", "num=42", "float=3.14", "bool=true", "null=null"},
			want: map[string]any{
				"str":   "hello",
				"num":   int64(42),
				"float": float64(3.14),
				"bool":  true,
				"null":  nil,
			},
		},
		{
			name: "json values",
			input: []string{
				`arr=[1,2,3]`,
				`obj={"foo":"bar"}`,
				`str="quoted"`,
			},
			want: map[string]any{
				"arr": []any{float64(1), float64(2), float64(3)},
				"obj": map[string]any{"foo": "bar"},
				"str": "quoted",
			},
		},
		{
			name: "nested paths",
			input: []string{
				"a/b=55",
				"a/c=2",
			},
			want: map[string]any{
				"a": map[string]any{
					"b": int64(55),
					"c": int64(2),
				},
			},
		},
		{
			name: "deep nesting",
			input: []string{
				"a/b/c/d=hello",
			},
			want: map[string]any{
				"a": map[string]any{
					"b": map[string]any{
						"c": map[string]any{
							"d": "hello",
						},
					},
				},
			},
		},
		{
			name: "override nested value",
			input: []string{
				"a/b/c=1",
				"a/b=2",
			},
			want: map[string]any{
				"a": map[string]any{
					"b": int64(2),
				},
			},
		},
		{
			name: "override with null",
			input: []string{
				"a/b=1",
				"a/c=2",
				"a=null",
			},
			want: map[string]any{
				"a": nil,
			},
		},
		{
			name: "mixed types in path",
			input: []string{
				"a/b=1",
				"a/c=[1,2,3]",
				"a/d/e=true",
			},
			want: map[string]any{
				"a": map[string]any{
					"b": int64(1),
					"c": []any{float64(1), float64(2), float64(3)},
					"d": map[string]any{
						"e": true,
					},
				},
			},
		},
		{
			name:    "invalid format",
			input:   []string{"invalid"},
			wantErr: true,
		},
		{
			name:    "invalid json",
			input:   []string{`a={"invalid`},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseMetaSets(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseMetaSets() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseMetaSets() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseMetaValue(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    any
		wantErr bool
	}{
		{"empty string", "", nil, false},
		{"null", "null", nil, false},
		{"true", "true", true, false},
		{"false", "false", false, false},
		{"integer", "42", int64(42), false},
		{"negative integer", "-42", int64(-42), false},
		{"hex integer", "0xff", int64(255), false},
		{"float", "3.14", float64(3.14), false},
		{"string", "hello", "hello", false},
		{"json array", "[1,2,3]", []any{float64(1), float64(2), float64(3)}, false},
		{"json object", `{"foo":"bar"}`, map[string]any{"foo": "bar"}, false},
		{"quoted string", `"quoted"`, "quoted", false},
		{"invalid json", `{"invalid`, nil, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseMetaValue(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseMetaValue() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseMetaValue() = %v, want %v", got, tt.want)
			}
		})
	}
}
