// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package packet

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
)

type PacketParser struct {
	Lock   *sync.Mutex
	MainCh chan PacketType
}

func CombinePacketParsers(p1 *PacketParser, p2 *PacketParser) *PacketParser {
	rtnParser := &PacketParser{
		Lock:   &sync.Mutex{},
		MainCh: make(chan PacketType),
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for v := range p1.MainCh {
			rtnParser.MainCh <- v
		}
	}()
	go func() {
		defer wg.Done()
		for v := range p2.MainCh {
			rtnParser.MainCh <- v
		}
	}()
	go func() {
		wg.Wait()
		close(rtnParser.MainCh)
	}()
	return rtnParser
}

func MakePacketParser(input io.Reader) *PacketParser {
	parser := &PacketParser{
		Lock:   &sync.Mutex{},
		MainCh: make(chan PacketType),
	}
	bufReader := bufio.NewReader(input)
	go func() {
		defer func() {
			close(parser.MainCh)
		}()
		for {
			line, err := bufReader.ReadString('\n')
			if err == io.EOF {
				return
			}
			if err != nil {
				errPacket := MakeErrorPacket(fmt.Sprintf("reading packets from input: %v", err))
				parser.MainCh <- errPacket
				return
			}
			if line == "\n" {
				continue
			}
			// ##[len][json]\n
			// ##14{"hello":true}\n
			bracePos := strings.Index(line, "{")
			if !strings.HasPrefix(line, "##") || bracePos == -1 {
				parser.MainCh <- MakeRawPacket(line[:len(line)-1])
				continue
			}
			packetLen := -1
			if line[2:bracePos] != "N" {
				packetLen, err = strconv.Atoi(line[2:bracePos])
				if err != nil || packetLen != len(line)-bracePos-1 {
					parser.MainCh <- MakeRawPacket(line[:len(line)-1])
					continue
				}
			}
			pk, err := ParseJsonPacket([]byte(line[bracePos:]))
			if err != nil {
				errPk := MakeErrorPacket(fmt.Sprintf("parsing packet json from input: %v", err))
				parser.MainCh <- errPk
				return
			}
			if pk.GetType() == DonePacketStr {
				return
			}
			parser.MainCh <- pk
		}
	}()
	return parser
}
