// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"
)

const WaveOSC = "23198"

func main() {
	barr, err := os.ReadFile("/Users/mike/Downloads/2.png")
	if err != nil {
		fmt.Println("error reading file:", err)
		return
	}
	fmt.Println("file size:", len(barr))
}
