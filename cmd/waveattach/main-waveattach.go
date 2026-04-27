// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/pkg/waveattach"
)

func usage() {
	fmt.Fprintln(os.Stderr, "usage: waveattach [blockid]")
	fmt.Fprintln(os.Stderr, "  Attach to a Wave Terminal block from an external terminal.")
	fmt.Fprintln(os.Stderr, "  Press Ctrl+A D to detach.")
}

func main() {
	if len(os.Args) > 2 {
		usage()
		os.Exit(2)
	}
	if len(os.Args) == 2 && (os.Args[1] == "-h" || os.Args[1] == "--help") {
		usage()
		os.Exit(0)
	}

	rpcClient, _, err := waveattach.Connect()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	var blockId string
	if len(os.Args) == 2 {
		blockId = os.Args[1]
	} else {
		blockId, err = waveattach.SelectBlock(rpcClient)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	}

	if err := waveattach.Attach(rpcClient, blockId); err != nil {
		os.Exit(1)
	}
}
