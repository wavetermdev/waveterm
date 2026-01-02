// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package packetparser

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"log"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

type PacketParser struct {
	Reader io.Reader
	Ch     chan []byte
}

func ParseWithLinesChan(input chan utilfn.LineOutput, packetCh chan baseds.RpcInputChType, rawCh chan []byte) {
	defer close(packetCh)
	defer close(rawCh)
	for {
		// note this line doesn't have a trailing newline
		line, ok := <-input
		if !ok {
			return
		}
		if line.Error != nil {
			log.Printf("ParseWithLinesChan: error reading line: %v", line.Error)
			return
		}
		if len(line.Line) <= 1 {
			// just a blank line
			continue
		}
		if bytes.HasPrefix([]byte(line.Line), []byte{'#', '#', 'N', '{'}) && bytes.HasSuffix([]byte(line.Line), []byte{'}'}) {
			// strip off the leading "##"
			packetCh <- baseds.RpcInputChType{MsgBytes: []byte(line.Line[3:len(line.Line)])}
		} else {
			rawCh <- []byte(line.Line)
		}
	}
}

func Parse(input io.Reader, packetCh chan baseds.RpcInputChType, rawCh chan []byte) error {
	bufReader := bufio.NewReader(input)
	defer close(packetCh)
	defer close(rawCh)
	for {
		// note this line does have a trailing newline
		line, err := bufReader.ReadBytes('\n')
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if len(line) <= 1 {
			// just a blank line
			continue
		}
		if bytes.HasPrefix(line, []byte{'#', '#', 'N', '{'}) && bytes.HasSuffix(line, []byte{'}', '\n'}) {
			// strip off the leading "##" and trailing "\n" (single byte)
			packetCh <- baseds.RpcInputChType{MsgBytes: line[3 : len(line)-1]}
		} else {
			rawCh <- line
		}
	}
}

func WritePacket(output io.Writer, packet []byte) error {
	if len(packet) < 2 {
		return nil
	}
	if packet[0] != '{' || packet[len(packet)-1] != '}' {
		return fmt.Errorf("invalid packet, must start with '{' and end with '}'")
	}
	fullPacket := make([]byte, 0, len(packet)+5)
	// we add the extra newline to make sure the ## appears at the beginning of the line
	// since writer isn't buffered, we want to send this all at once
	fullPacket = append(fullPacket, '\n', '#', '#', 'N')
	fullPacket = append(fullPacket, packet...)
	fullPacket = append(fullPacket, '\n')
	_, err := output.Write(fullPacket)
	return err
}
