// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"log"
	"reflect"
	"testing"
)

type TestBlock struct {
	BlockId string `json:"blockid" waveobj:"oid"`
	Name    string `json:"name"`
}

func (TestBlock) GetOType() string {
	return "block"
}

func TestGenerate(t *testing.T) {
	log.Printf("Testing Generate\n")
	tsMap := make(map[reflect.Type]string)
	var waveObj WaveObj
	GenerateTSType(reflect.TypeOf(&waveObj).Elem(), tsMap)
	GenerateTSType(reflect.TypeOf(TestBlock{}), tsMap)
	for k, v := range tsMap {
		log.Printf("Type: %v, TS:\n%s\n", k, v)
	}
}
