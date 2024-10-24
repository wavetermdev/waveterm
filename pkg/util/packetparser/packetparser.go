// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package packetparser

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
)

type PacketParser struct {
	Reader io.Reader
	Ch     chan []byte
}

func Parse(input io.Reader, packetCh chan []byte, rawCh chan []byte) error {
	bufReader := bufio.NewReader(input)
	defer close(packetCh)
	defer close(rawCh)
	for {
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
			packetCh <- line[3 : len(line)-1]
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
