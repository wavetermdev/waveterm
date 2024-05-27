// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

func main() {
	tsTypesMap := make(map[reflect.Type]string)
	var waveObj waveobj.WaveObj
	waveobj.GenerateTSType(reflect.TypeOf(waveobj.ORef{}), tsTypesMap)
	waveobj.GenerateTSType(reflect.TypeOf(&waveObj).Elem(), tsTypesMap)
	for _, rtype := range wstore.AllWaveObjTypes() {
		waveobj.GenerateTSType(rtype, tsTypesMap)
	}
	for _, ts := range tsTypesMap {
		fmt.Print(ts)
		fmt.Print("\n")
	}
}
